import "@fontsource/saira-extra-condensed/600.css";
import "@fontsource/saira-extra-condensed/700.css";
import "@fontsource/saira/500.css";
import "@fontsource/saira/600.css";
import { KioskApp } from "./app";
import "./styles.css";

const root = document.querySelector("#app");
if (!root || !(root instanceof HTMLElement)) {
  throw new Error("Missing #app");
}

const app = new KioskApp(root);
app.start().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  root.innerHTML = `<div class="boot">Could not start the kiosk.<br>${message}</div>`;
  console.error(error);
});
