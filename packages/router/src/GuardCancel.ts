import { IGuardCancel } from "./types";

export class GuardCancel extends Error implements IGuardCancel {
  fallbackPath: string;

  constructor(message: string, fallbackPath: string) {
    super(message);
    this.fallbackPath = fallbackPath;
  }
}