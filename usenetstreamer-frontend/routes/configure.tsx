import { define } from "../utils.ts";
import ConfigForm from "../islands/ConfigForm.tsx";

export default define.page(function ConfigPage() {
  return (
    <div class="mx-auto max-w-4xl px-5 py-14">
      <p class="kicker mb-3">Console</p>
      <h1 class="font-serif text-4xl text-ink sm:text-5xl">Wire the stack.</h1>
      <p class="mt-4 max-w-2xl text-sm leading-relaxed text-mute">
        Values land in SQLite on the shared <code class="text-brass-soft">usenet-data</code> volume.
        Process env still wins. A key set in Compose stays locked here.
      </p>
      <div class="mt-10">
        <ConfigForm />
      </div>
    </div>
  );
});
