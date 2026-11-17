// A small state over the real merge logic, mounted by @wcstack/testing in tests/members.test.mjs.
import { mergeContacts } from "../../public/js/logic.js";

export default {
  members: [{ name: "山田 花子", email: "hanako@example.jp" }],
  message: "",
  picked: [],
  get count() { return this.members.length; },
  merge() {
    const r = mergeContacts(this.members, this.picked);
    this.members = r.members;
    this.message = `${r.added}人を加えました`;
  },
};
