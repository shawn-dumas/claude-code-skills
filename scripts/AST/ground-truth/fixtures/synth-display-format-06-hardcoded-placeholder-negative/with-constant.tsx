import { NO_VALUE_PLACEHOLDER } from "@/shared/constants";

function columnWithConstant(value: string | null) {
  return value ?? NO_VALUE_PLACEHOLDER;
}

export { columnWithConstant };
