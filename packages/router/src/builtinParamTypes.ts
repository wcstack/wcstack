import { BuiltinParamTypes, IParamTypeInfo } from "./types";

export const builtinParamTypes = {
  "int": {
    typeName: "int",
    pattern: /^-?\d+$/,
    parse(value: string): number | undefined {
      if (!this.pattern.test(value)) {
        return undefined;
      }
      return parseInt(value, 10);
    }
  },

  "float": {
    typeName: "float",
    pattern: /^-?\d+(?:\.\d+)?$/,
    parse(value: string): number | undefined {
      if (!this.pattern.test(value)) {
        return undefined;
      }
      return parseFloat(value);
    }
  },

  "bool": {
    typeName: "bool",
    pattern: /^(true|false|0|1)$/,
    parse(value: string): boolean | undefined {
      if (!this.pattern.test(value)) {
        return undefined;
      }
      return value === "true" || value === "1";
    }
  },

  "uuid": {
    typeName: "uuid",
    pattern: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    parse(value: string): string | undefined {
      if (!this.pattern.test(value)) {
        return undefined;
      }
      return value;
    }
  },

  "slug": {
    typeName: "slug",
    pattern: /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    parse(value: string): string | undefined {
      if (!this.pattern.test(value)) {
        return undefined;
      }
      return value;
    }
  },

  "isoDate": {
    typeName: "isoDate",
    pattern: /^\d{4}-\d{2}-\d{2}$/,
    parse(value: string): Date | undefined {
      if (!this.pattern.test(value)) {
        return undefined;
      }
      const [year, month, day] = value.split("-").map(Number);
      const date = new Date(year, month - 1, day);
      // 元の値と一致するか確認（補正されていないか）
      if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
        return undefined;
      }
      return date;
    }
  },

  "any": {
    typeName: "any",
    pattern: /^.+$/,
    parse(value: string): string | undefined {
      if (!this.pattern.test(value)) {
        return undefined;
      }
      return value;
    }
  },
} satisfies Record<BuiltinParamTypes, IParamTypeInfo<unknown>>;
