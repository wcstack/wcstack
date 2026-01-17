import { IGuardCancel } from "./types";
export declare class GuardCancel extends Error implements IGuardCancel {
    fallbackPath: string;
    constructor(message: string, fallbackPath: string);
}
//# sourceMappingURL=GuardCancel.d.ts.map