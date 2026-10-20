type CssModule = Record<string, string | undefined>;
type ClassNameInput = CssModule | string | false | null | undefined;

export function cx(...inputs: ClassNameInput[]): string {
  const modules = inputs.filter((input): input is CssModule => typeof input === "object" && input !== null);
  const names = inputs
    .filter((input): input is string => typeof input === "string")
    .flatMap((input) => input.split(/\s+/).filter(Boolean));

  return names
    .flatMap((name) => {
      const scoped = modules.map((module) => module[name]).filter((value): value is string => Boolean(value));
      return scoped.length > 0 ? scoped : [name];
    })
    .join(" ");
}
