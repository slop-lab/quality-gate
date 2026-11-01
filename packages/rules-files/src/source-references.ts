import {
  createValidFileReferenceRule,
  type ValidFileReferenceOptions,
} from "./file-references.js";
import {
  type SourceCommentReferenceOptions,
  sourceCommentMarkdownReferencePlugin,
} from "./source-comment-references.js";

export interface ValidSourceReferenceOptions
  extends ValidFileReferenceOptions,
    SourceCommentReferenceOptions {}

export const validSourceReferenceRule =
  createValidFileReferenceRule<ValidSourceReferenceOptions>({
    id: "source/valid-reference",
    name: "Valid source reference",
    description:
      "Validates local file references extracted from source comments.",
    plugins: [sourceCommentMarkdownReferencePlugin],
    defaultOptions: {},
  });
