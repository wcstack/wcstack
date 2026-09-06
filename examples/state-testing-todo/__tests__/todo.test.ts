import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { mount, settle, fire, type MountedApp } from "@wcstack/testing";

// Mount only the app fragment: the page's <head> loads @wcstack/state from the CDN,
// which a headless test must not (and need not) do — mount() registers the elements.
const page = readFileSync(resolve(__dirname, "..", "index.html"), "utf8");
const fragment = /<main id="app">([\s\S]*?)<\/main>/.exec(page)![1];

let app: MountedApp;
beforeEach(async () => {
  app = await mount(fragment);
});
afterEach(() => {
  app.unmount();
});

const todos = () => [...app.root.querySelectorAll<HTMLLIElement>("#todos li")];
const remaining = () => app.root.querySelector("#remaining")!.textContent;

describe("todo page", () => {
  it("renders the initial list", () => {
    expect(todos().map((li) => li.querySelector("span")!.textContent)).toEqual(["Write the tests first"]);
    expect(remaining()).toBe("1");
  });

  it("adds a todo through the form, exactly as a user would", async () => {
    const input = app.root.querySelector<HTMLInputElement>("#draft")!;
    input.value = "  Ship it  ";
    fire(input, "input");                                   // two-way binding writes `draft`
    fire(app.root.querySelector("form")!, "submit", { cancelable: true });   // onsubmit#prevent: add
    await settle();

    expect(todos().map((li) => li.querySelector("span")!.textContent)).toEqual(["Write the tests first", "Ship it"]);
    expect(remaining()).toBe("2");
    expect(input.value).toBe("");                           // draft was cleared by add()
    expect(app.state().read((s) => s.todos.length)).toBe(2);
  });

  it("ignores an empty draft", async () => {
    const input = app.root.querySelector<HTMLInputElement>("#draft")!;
    input.value = "   ";
    fire(input, "input");
    fire(app.root.querySelector("form")!, "submit", { cancelable: true });
    await settle();
    expect(todos()).toHaveLength(1);
  });

  it("toggling a checkbox updates the row class and the remaining count", async () => {
    const checkbox = todos()[0].querySelector<HTMLInputElement>("input")!;
    checkbox.checked = true;
    fire(checkbox, "input");            // two-way `checked:` listens to `input` (browsers fire it before `change`)
    await settle();

    expect(todos()[0].classList.contains("done")).toBe(true);
    expect(remaining()).toBe("0");
    expect(app.state().read((s) => s.todos[0].done)).toBe(true);
  });

  it("state writes drive the DOM the same way handlers do", async () => {
    await app.state().write((s) => {
      s.todos = [...s.todos, { title: "From the test", done: true }];
    });
    await settle();
    expect(todos()).toHaveLength(2);
    expect(todos()[1].classList.contains("done")).toBe(true);
    expect(remaining()).toBe("1");

    fire(app.root.querySelector("#clear")!, "click");
    await settle();
    expect(todos().map((li) => li.querySelector("span")!.textContent)).toEqual(["Write the tests first"]);
  });
});
