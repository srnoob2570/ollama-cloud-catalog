// Uppercase only known acronyms; the old length rule produced "Deepseek V4 PRO".
const KNOWN_ACRONYMS = new Set(["gpt", "oss", "glm", "llm"]);

export const familyOf = (id: string) => id.split(":")[0]!;
export const tagOf = (id: string) =>
  id.includes(":") ? (id.split(":")[1] ?? "") : "";

const titleCase = (family: string) =>
  family
    .split(/[-_:]/)
    .filter(Boolean)
    .map((part) =>
      KNOWN_ACRONYMS.has(part.toLowerCase())
        ? part.toUpperCase()
        : part.charAt(0).toUpperCase() + part.slice(1),
    )
    .join(" ");

export const displayName = (id: string) => {
  const tag = tagOf(id);
  return tag
    ? `${titleCase(familyOf(id))} ${tag.toUpperCase()}`
    : titleCase(familyOf(id));
};