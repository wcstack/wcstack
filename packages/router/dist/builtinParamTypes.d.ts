export declare const builtinParamTypes: {
    int: {
        typeName: string;
        pattern: RegExp;
        parse(value: string): number | undefined;
    };
    float: {
        typeName: string;
        pattern: RegExp;
        parse(value: string): number | undefined;
    };
    bool: {
        typeName: string;
        pattern: RegExp;
        parse(value: string): boolean | undefined;
    };
    uuid: {
        typeName: string;
        pattern: RegExp;
        parse(value: string): string | undefined;
    };
    slug: {
        typeName: string;
        pattern: RegExp;
        parse(value: string): string | undefined;
    };
    isoDate: {
        typeName: string;
        pattern: RegExp;
        parse(value: string): Date | undefined;
    };
    any: {
        typeName: string;
        pattern: RegExp;
        parse(value: string): string | undefined;
    };
};
//# sourceMappingURL=builtinParamTypes.d.ts.map