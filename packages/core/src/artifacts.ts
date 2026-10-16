import { matchesAnyGlob } from "./config.js";
import type {
  GeneratedArtifactDefinition,
  GeneratedArtifacts,
  GeneratedArtifactsConfig,
} from "./types.js";

export const defaultGeneratedArtifacts: GeneratedArtifactDefinition[] = [
  {
    id: "qg/lockfiles",
    files: [
      "**/package-lock.json",
      "**/npm-shrinkwrap.json",
      "**/pnpm-lock.yaml",
      "**/yarn.lock",
      "**/bun.lock",
      "**/bun.lockb",
    ],
    description: "Package manager generated lockfiles.",
  },
  {
    id: "qg/typescript-build-info",
    files: ["**/*.tsbuildinfo"],
    description: "TypeScript incremental build state.",
  },
  {
    id: "qg/minified",
    files: ["**/*.min.js", "**/*.min.css"],
    description: "Minified JavaScript and CSS.",
  },
  {
    id: "qg/source-maps",
    files: ["**/*.map"],
    description: "Generated source maps.",
  },
];

/** Immutable per-scan registry; plugin contributions do not depend on execution order. */
export class GeneratedArtifactRegistry implements GeneratedArtifacts {
  private readonly definitions: GeneratedArtifactDefinition[];
  private readonly excluded: string[];
  private readonly classifications = new Map<
    string,
    GeneratedArtifactDefinition[]
  >();

  constructor(
    contributions: GeneratedArtifactDefinition[] = [],
    config: GeneratedArtifactsConfig = {},
  ) {
    if (config.defaults !== undefined && typeof config.defaults !== "boolean")
      throw new Error("artifacts.generated.defaults must be a boolean.");
    validatePatterns(config.include ?? [], "artifacts.generated.include");
    validatePatterns(config.exclude ?? [], "artifacts.generated.exclude");
    const definitions = [
      ...(config.defaults === false ? [] : defaultGeneratedArtifacts),
      ...contributions,
    ];
    if (config.include?.length)
      definitions.push({ id: "qg/project-generated", files: config.include });
    const byId = new Map<string, GeneratedArtifactDefinition>();
    for (const definition of definitions) {
      if (typeof definition.id !== "string" || !definition.id)
        throw new Error("Generated artifact definitions require an id.");
      validatePatterns(definition.files, `${definition.id}.files`);
      validatePatterns(
        definition.excludedFiles ?? [],
        `${definition.id}.excludedFiles`,
      );
      const copy = {
        id: definition.id,
        files: [...definition.files],
        excludedFiles: [...(definition.excludedFiles ?? [])],
        description: definition.description,
      };
      const previous = byId.get(copy.id);
      if (previous && JSON.stringify(previous) !== JSON.stringify(copy))
        throw new Error(
          `Conflicting generated artifact definitions: ${copy.id}.`,
        );
      byId.set(copy.id, copy);
    }
    this.definitions = [...byId.values()];
    this.excluded = [...(config.exclude ?? [])];
  }

  isGenerated(path: string): boolean {
    return this.classify(path).length > 0;
  }

  matching(path: string): GeneratedArtifactDefinition[] {
    return this.classify(path).map((definition) => ({
      ...definition,
      files: [...definition.files],
      excludedFiles: [...(definition.excludedFiles ?? [])],
    }));
  }

  private classify(path: string): GeneratedArtifactDefinition[] {
    const normalized = path.replaceAll("\\", "/").replace(/^\.\//, "");
    const cached = this.classifications.get(normalized);
    if (cached) return cached;
    const matches = matchesAnyGlob(normalized, this.excluded)
      ? []
      : this.definitions.filter(
          (definition) =>
            matchesAnyGlob(normalized, definition.files) &&
            !matchesAnyGlob(normalized, definition.excludedFiles ?? []),
        );
    this.classifications.set(normalized, matches);
    return matches;
  }
}

function validatePatterns(value: string[], label: string): void {
  if (
    !Array.isArray(value) ||
    value.some(
      (pattern) =>
        typeof pattern !== "string" ||
        !pattern ||
        pattern.includes("\\") ||
        pattern.startsWith("/") ||
        pattern.includes(":") ||
        pattern.split("/").includes(".."),
    )
  )
    throw new Error(
      `${label} must contain non-empty project-relative globs using '/'.`,
    );
}
