/** html-custom-data.mjs の型宣言(テストの TS import 用)。 */
export interface HtmlCustomDataAttribute {
  readonly name: string;
  readonly description: string;
}

export interface HtmlCustomDataTag {
  readonly name: string;
  readonly description: { readonly kind: "markdown"; readonly value: string };
  readonly attributes: readonly HtmlCustomDataAttribute[];
  readonly references: readonly { readonly name: string; readonly url: string }[];
}

export interface HtmlCustomData {
  readonly version: number;
  readonly tags: readonly HtmlCustomDataTag[];
  readonly globalAttributes: readonly unknown[];
}

export function buildHtmlCustomData(
  tags: Readonly<Record<string, {
    readonly package: string;
    readonly inputs: Readonly<Record<string, string | null>>;
    readonly properties: readonly string[];
    readonly commands: readonly string[];
  }>>,
): HtmlCustomData;
