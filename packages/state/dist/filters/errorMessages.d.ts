/**
 * Throws error when filter requires at least one option but none provided.
 *
 * @param fnName - Name of the filter function
 * @returns Never returns (always throws)
 */
export declare function optionsRequired(fnName: string): never;
/**
 * Throws error when filter option must be a number but invalid value provided.
 *
 * @param fnName - Name of the filter function
 * @returns Never returns (always throws)
 */
export declare function optionMustBeNumber(fnName: string): never;
/**
 * Throws error when filter requires numeric value but non-number provided.
 *
 * @param fnName - Name of the filter function
 * @returns Never returns (always throws)
 */
export declare function valueMustBeNumber(fnName: string): never;
/**
 * Throws error when filter requires numeric value but non-number provided.
 *
 * @param fnName - Name of the filter function
 * @returns Never returns (always throws)
 */
export declare function valueMustBeString(fnName: string): never;
/**
 * Throws error when filter requires boolean value but non-boolean provided.
 *
 * @param fnName - Name of the filter function
 * @returns Never returns (always throws)
 */
export declare function valueMustBeBoolean(fnName: string): never;
/**
 * Throws error when filter requires Date value but non-Date provided.
 *
 * @param fnName - Name of the filter function
 * @returns Never returns (always throws)
 */
export declare function valueMustBeDate(fnName: string): never;
//# sourceMappingURL=errorMessages.d.ts.map