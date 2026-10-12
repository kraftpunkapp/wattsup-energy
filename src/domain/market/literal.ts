// Lecture des littéraux JavaScript des fichiers de tarifs de la source (SPEC §7.12) : les
// fichiers sont des scripts `defineTarif({...})` que WattsUp n'exécute jamais. Seuls les
// objets, tableaux, chaînes, nombres, booléens et `null` sont acceptés, avec commentaires
// et virgules finales, ainsi que l'arithmétique sur des nombres (`(47.88 + 99.37) / 12`,
// écrite par la source pour certains abonnements) ; tout le reste (identifiant, appel,
// gabarit, opération sur autre chose qu'un nombre) est refusé.

export type Literal = null | boolean | number | string | Literal[] | { [key: string]: Literal };

/** Arguments littéraux d'un appel : `value` est le premier, `args` tous, dans l'ordre. */
export type CallArgument =
  { ok: true; value: Literal; args: Literal[] } | { ok: false; error: string };

const MAX_DEPTH = 32;
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const IDENT_START = /[A-Za-z_$]/;
const IDENT_PART = /[A-Za-z0-9_$]/;
const NUMBER = /^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/;

class Reader {
  pos: number;
  constructor(
    readonly src: string,
    pos = 0,
  ) {
    this.pos = pos;
  }

  fail(message: string): never {
    throw new Error(`${message} (position ${this.pos})`);
  }

  /** Avance après les blancs et les commentaires. */
  skip() {
    const s = this.src;
    for (;;) {
      while (this.pos < s.length && /\s/.test(s[this.pos] as string)) this.pos++;
      if (s.startsWith("//", this.pos)) {
        const end = s.indexOf("\n", this.pos);
        this.pos = end === -1 ? s.length : end + 1;
      } else if (s.startsWith("/*", this.pos)) {
        const end = s.indexOf("*/", this.pos + 2);
        if (end === -1) this.fail("commentaire non fermé");
        this.pos = end + 2;
      } else return;
    }
  }

  peek(): string | undefined {
    return this.src[this.pos];
  }

  expect(char: string) {
    this.skip();
    if (this.peek() !== char) this.fail(`« ${char} » attendu`);
    this.pos++;
  }

  value(depth: number): Literal {
    if (depth > MAX_DEPTH) this.fail("profondeur maximale dépassée");
    this.skip();
    const c = this.peek();
    if (c === "{") return this.object(depth);
    if (c === "[") return this.array(depth);
    if (c === '"' || c === "'") return this.string();
    if (c !== undefined && /[-.(\d]/.test(c)) return this.arithmetic(depth);
    const word = this.identifier();
    if (word === "true") return true;
    if (word === "false") return false;
    if (word === "null") return null;
    return this.fail(word ? `élément non littéral « ${word} »` : "valeur attendue");
  }

  identifier(): string {
    const s = this.src;
    if (!IDENT_START.test(s[this.pos] ?? "")) return "";
    const start = this.pos;
    while (this.pos < s.length && IDENT_PART.test(s[this.pos] as string)) this.pos++;
    return s.slice(start, this.pos);
  }

  /** Somme, différence, produit et quotient de nombres, avec parenthèses. */
  arithmetic(depth: number): number {
    let total = this.term(depth);
    for (;;) {
      this.skip();
      const op = this.peek();
      if (op !== "+" && op !== "-") break;
      this.pos++;
      const right = this.term(depth);
      total = op === "+" ? total + right : total - right;
    }
    if (!Number.isFinite(total)) this.fail("calcul invalide");
    return total;
  }

  term(depth: number): number {
    let total = this.factor(depth);
    for (;;) {
      this.skip();
      const op = this.peek();
      if (op !== "*" && op !== "/") break;
      this.pos++;
      const right = this.factor(depth);
      total = op === "*" ? total * right : total / right;
    }
    return total;
  }

  factor(depth: number): number {
    if (depth > MAX_DEPTH) this.fail("profondeur maximale dépassée");
    this.skip();
    const c = this.peek();
    if (c === "(") {
      this.pos++;
      const value = this.arithmetic(depth + 1);
      this.expect(")");
      return value;
    }
    if (c === "-" && !/[\d.]/.test(this.src[this.pos + 1] ?? "")) {
      this.pos++;
      return -this.factor(depth + 1);
    }
    if (c === undefined || !/[-.\d]/.test(c)) this.fail("nombre attendu");
    return this.number();
  }

  number(): number {
    const m = NUMBER.exec(this.src.slice(this.pos, this.pos + 64));
    if (!m) this.fail("nombre invalide");
    this.pos += m[0].length;
    const n = Number(m[0]);
    if (!Number.isFinite(n)) this.fail("nombre invalide");
    return n;
  }

  string(): string {
    const s = this.src;
    const quote = s[this.pos];
    this.pos++;
    let out = "";
    while (this.pos < s.length) {
      const c = s[this.pos] as string;
      if (c === quote) {
        this.pos++;
        return out;
      }
      if (c === "\n") this.fail("chaîne non fermée");
      if (c === "\\") {
        const e = s[this.pos + 1];
        this.pos += 2;
        if (e === "n") out += "\n";
        else if (e === "t") out += "\t";
        else if (e === "r") out += "\r";
        else if (e === "u") {
          const hex = s.slice(this.pos, this.pos + 4);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) this.fail("échappement \\u invalide");
          out += String.fromCharCode(parseInt(hex, 16));
          this.pos += 4;
        } else if (e === undefined) this.fail("chaîne non fermée");
        else out += e;
        continue;
      }
      out += c;
      this.pos++;
    }
    return this.fail("chaîne non fermée");
  }

  key(): string {
    this.skip();
    const c = this.peek();
    let key: string;
    if (c === '"' || c === "'") key = this.string();
    else if (c !== undefined && /\d/.test(c)) key = String(this.number());
    else {
      key = this.identifier();
      if (!key) this.fail("clé attendue");
    }
    if (FORBIDDEN_KEYS.has(key)) this.fail(`clé interdite « ${key} »`);
    return key;
  }

  object(depth: number): { [key: string]: Literal } {
    this.pos++; // {
    const out: { [key: string]: Literal } = {};
    for (;;) {
      this.skip();
      if (this.peek() === "}") {
        this.pos++;
        return out;
      }
      const key = this.key();
      this.expect(":");
      out[key] = this.value(depth + 1);
      this.skip();
      if (this.peek() === ",") this.pos++;
      else if (this.peek() !== "}") this.fail("« , » ou « } » attendu");
    }
  }

  array(depth: number): Literal[] {
    this.pos++; // [
    const out: Literal[] = [];
    for (;;) {
      this.skip();
      if (this.peek() === "]") {
        this.pos++;
        return out;
      }
      out.push(this.value(depth + 1));
      this.skip();
      if (this.peek() === ",") this.pos++;
      else if (this.peek() !== "]") this.fail("« , » ou « ] » attendu");
    }
  }
}

/** Un littéral seul (tout le texte). */
export function parseLiteral(src: string): Literal {
  const r = new Reader(src);
  const value = r.value(0);
  r.skip();
  if (r.pos < src.length) r.fail("texte en trop après la valeur");
  return value;
}

/** Littéral affecté juste après `marker` (ex. `TARIF_SCRIPTS =` suivi d'un tableau). */
export function literalAfter(src: string, marker: string): Literal {
  const at = src.indexOf(marker);
  if (at === -1) throw new Error(`« ${marker} » introuvable`);
  const r = new Reader(src, at + marker.length);
  r.expect("=");
  return r.value(0);
}

/**
 * Argument littéral de chaque appel `name(...)` du script, dans l'ordre. Commentaires et
 * chaînes sont sautés ; un appel illisible est signalé sans empêcher la lecture des autres.
 */
export function findCallArguments(src: string, name: string): CallArgument[] {
  const out: CallArgument[] = [];
  const r = new Reader(src);
  while (r.pos < src.length) {
    const c = src[r.pos] as string;
    if (c === "/" && (src[r.pos + 1] === "/" || src[r.pos + 1] === "*")) {
      r.skip();
    } else if (c === '"' || c === "'" || c === "`") {
      const end = skipString(src, r.pos);
      r.pos = end;
    } else if (IDENT_START.test(c)) {
      const word = r.identifier();
      if (word !== name) continue;
      r.skip();
      if (r.peek() !== "(") continue;
      r.pos++;
      const start = r.pos;
      try {
        const args = [r.value(0)];
        for (r.skip(); r.peek() === ","; r.skip()) {
          r.pos++;
          r.skip();
          if (r.peek() === ")") break; // virgule finale
          args.push(r.value(0));
        }
        r.expect(")");
        out.push({ ok: true, value: args[0] as Literal, args });
      } catch (err) {
        out.push({ ok: false, error: (err as Error).message });
        r.pos = start;
      }
    } else {
      r.pos++;
    }
  }
  return out;
}

/** Position juste après la chaîne (ou le gabarit) qui commence en `pos`. */
function skipString(src: string, pos: number): number {
  const quote = src[pos];
  let i = pos + 1;
  while (i < src.length && src[i] !== quote) i += src[i] === "\\" ? 2 : 1;
  return i + 1;
}
