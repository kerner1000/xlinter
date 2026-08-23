import { z } from "zod";
import { parseSelector, SelectorError } from "./jsonpath.js";

/**
 * Config-time validation for user-supplied selectors and regexes: a malformed
 * selector/regex is a config error (exit 2) at options-validation time, never
 * a runtime crash finding. This makes the contract documented in jsonpath.ts
 * true at the only layer that can enforce it.
 */
export const selectorString = z
  .string()
  .min(1)
  .superRefine((s, ctx) => {
    try {
      parseSelector(s);
    } catch (e) {
      ctx.addIssue({
        code: "custom",
        message: e instanceof SelectorError ? e.message : String(e),
      });
    }
  });

export const regexString = z
  .string()
  .min(1)
  .superRefine((s, ctx) => {
    try {
      new RegExp(s);
    } catch (e) {
      ctx.addIssue({ code: "custom", message: `invalid regex: ${(e as Error).message}` });
    }
  });
