/** En-têtes d'un fichier à télécharger, jamais mis en cache. */
export const attachment = (filename: string, type: string) => ({
  "content-type": type,
  "content-disposition": `attachment; filename="${filename}"`,
  "cache-control": "no-store",
});
