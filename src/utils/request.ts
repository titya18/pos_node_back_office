// src/utils/request.ts
import { ParsedQs } from "qs";

type QueryValue = string | ParsedQs | Array<string | ParsedQs> | undefined;

export const getQueryString = (
  value: QueryValue,
  defaultValue?: string
): string | undefined => {
  if (Array.isArray(value)) {
    const v = value[0];
    return typeof v === "string" ? v : defaultValue;
  }

  if (typeof value === "string") return value;

  return defaultValue;
};

export const getQueryNumber = (
  value: QueryValue,
  defaultValue?: number
): number | undefined => {
  const str =
    typeof value === "string"
      ? value
      : Array.isArray(value) && typeof value[0] === "string"
      ? value[0]
      : undefined;

  if (str === undefined) return defaultValue;

  const num = Number(str);
  return isNaN(num) ? defaultValue : num;
};
