import { define } from "../utils.ts";
import ConfigForm from "../islands/ConfigForm.tsx"; // Note: `islands` is the convention for Fresh

export default define.page(function ConfigPage() {
    return (
        <>
            <div class="min-h-screen flex flex-col items-center justify-center bg-slate-950 py-16">
                <div class="w-full max-w-4xl mx-auto px-6">
                    <h1 class="text-4xl font-extrabold tracking-tight text-white sm:text-5xl text-center mb-12">
                        <span class="bg-gradient-to-r from-sky-400 via-cyan-400 to-teal-400 bg-clip-text text-transparent">
                            Configuration
                        </span>
                    </h1>
                    <ConfigForm />
                </div>
            </div>
        </>
    );
});