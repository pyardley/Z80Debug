import { mount } from "./play-ui";

const root = document.querySelector("#app");
if (!root) {
  throw new Error("Missing #app");
}
mount(root as HTMLElement);
