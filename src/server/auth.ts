import { eq } from "drizzle-orm";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { NAME_MAX, signupAllowed, validName } from "@/domain/signup";
import { confirmEmailEmail, resetPasswordEmail } from "@/domain/mail";
import { promoteFirstAdmin } from "./admin";
import { ensureHousehold } from "./household";
import { getSignupPolicy } from "./instance";
import { mailConfigured, sendMail } from "./mail";

// Envoi d'emails configuré au démarrage (MAIL_FROM, BREVO_API_KEY ou RESEND_API_KEY) : mot de passe oublié et
// confirmation d'une nouvelle adresse par lien.
const mailOn = mailConfigured();

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg", schema }),
  // Session de 90 jours, prolongée à chaque visite (au plus une fois par jour).
  session: {
    expiresIn: 60 * 60 * 24 * 90,
    updateAge: 60 * 60 * 24,
  },
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 10,
    // Mot de passe oublié (si l'envoi d'emails est configuré) : lien valable une heure ;
    // les sessions ouvertes sont fermées après le changement.
    ...(mailOn
      ? {
          resetPasswordTokenExpiresIn: 3600,
          revokeSessionsOnPasswordReset: true,
          sendResetPassword: async ({
            user,
            url,
          }: {
            user: { email: string; name: string };
            url: string;
          }) => {
            await sendMail(user.email, resetPasswordEmail(user.name, url));
          },
        }
      : {}),
  },
  user: {
    // Administrateur de l'instance (SPEC §5) : lu dans la session, jamais saisissable
    // (input: false, refusé à l'inscription comme dans updateUser). Le premier compte d'une
    // instance sans administrateur le devient (hook user.create.after).
    additionalFields: {
      isAdmin: { type: "boolean", required: false, defaultValue: false, input: false },
      // Thème (T43) : changé par une action dédiée qui valide la valeur.
      theme: { type: "string", required: false, defaultValue: "light", input: false },
    },
    // Suppression du compte depuis la page Compte (mot de passe exigé) : le foyer et toutes
    // ses données partent en cascade.
    deleteUser: { enabled: true },
    // Changement d'email depuis la page Compte (T52), mot de passe actuel exigé (hook
    // ci-dessous). Avec l'envoi d'emails, la nouvelle adresse ne remplace l'ancienne qu'une
    // fois le lien qui lui est envoyé ouvert ; sans, le changement s'applique directement
    // (l'interface fait saisir l'adresse deux fois).
    changeEmail: { enabled: true, updateEmailWithoutVerification: !mailOn },
  },
  ...(mailOn
    ? {
        emailVerification: {
          expiresIn: 3600,
          sendVerificationEmail: async ({
            user,
            url,
          }: {
            user: { email: string; name: string };
            url: string;
          }) => {
            await sendMail(user.email, confirmEmailEmail(user.name, url));
          },
        },
      }
    : {}),
  hooks: {
    // L'inscription respecte le mode de l'instance (réglage de l'administrateur, sinon
    // SIGNUP_MODE), y compris par un appel direct à l'API.
    before: createAuthMiddleware(async (ctx) => {
      // Nom affiché (inscription, page Compte) : non vide, NAME_MAX caractères au plus.
      if (ctx.path === "/sign-up/email" || ctx.path === "/update-user") {
        const name: unknown = ctx.body?.name;
        if (name !== undefined && !validName(name)) {
          throw new APIError("BAD_REQUEST", {
            message: `nom attendu, ${NAME_MAX} caractères au plus`,
          });
        }
      }
      // Changement d'email : mot de passe actuel exigé. Une session volée ne suffit donc
      // pas à détourner le compte (nouvelle adresse puis « mot de passe oublié »).
      if (ctx.path === "/change-email") {
        const session = await getSessionFromCtx(ctx);
        if (!session) return; // refusé ensuite par Better Auth (401)
        const password: unknown = ctx.body?.password;
        const account = await ctx.context.internalAdapter.findCredentialAccount(session.user.id);
        const valid =
          typeof password === "string" &&
          password.length <= 128 &&
          Boolean(account?.password) &&
          (await ctx.context.password.verify({ hash: account?.password ?? "", password }));
        if (!valid) {
          throw new APIError("BAD_REQUEST", {
            message: "mot de passe incorrect",
            code: "INVALID_PASSWORD",
          });
        }
        return;
      }
      if (ctx.path !== "/sign-up/email") return;
      const policy = await getSignupPolicy();
      const allowed = signupAllowed(policy.mode, ctx.headers?.get("x-invite-code"), policy.codes);
      if (!allowed.ok) throw new APIError("FORBIDDEN", { message: allowed.message });
    }),
  },
  databaseHooks: {
    session: {
      create: {
        // Compte désactivé par l'administrateur : connexion refusée, mot de passe juste ou non
        // vérifié avant (le message ne révèle donc rien à qui ne connaît pas le mot de passe).
        before: async (s) => {
          const [row] = await db
            .select({ disabledAt: schema.user.disabledAt })
            .from(schema.user)
            .where(eq(schema.user.id, s.userId));
          if (row?.disabledAt) {
            throw new APIError("FORBIDDEN", {
              message: "Ce compte est désactivé. Contactez l'administrateur de l'instance.",
            });
          }
        },
      },
    },
    user: {
      create: {
        // Chaque compte a son foyer (1 par utilisateur en V1). ensureHousehold est
        // idempotent : getHouseholdContext le rappelle si ce hook a échoué.
        after: async (user) => {
          await ensureHousehold(user.id);
          await promoteFirstAdmin(user.id);
        },
      },
    },
  },
  plugins: [nextCookies()],
});

export type Session = typeof auth.$Infer.Session;
