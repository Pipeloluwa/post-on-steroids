class Window {
    constructor() {
        this.listeners = [];
    }
    addEventListener(type, listener) {
        this.listeners.push(listener);
    }
    dispatchEvent(event) {
        for (let listener of this.listeners) listener(event);
    }
}
const window = new Window();

const sandboxScript = 
window.addEventListener("message", async (event) => {
    const code = event.data.code;
    const fnBody = "return (async () => {\\n"
        + code + "\\n"
        + "if (typeof preScript === 'function') { console.log('preScript exists'); }\\n"
        + "})();";
    
    console.log("fnBody text:\\n" + fnBody);
    
    try {
        const executeInSandbox = new Function("pm", "context", "test", fnBody);
        await executeInSandbox(null, null, null);
    } catch (e) {
        console.error("Error creating function:", e);
    }
});
;

eval(sandboxScript);

window.dispatchEvent({
    type: "message",
    data: {
        code: "function preScript() {}\n// a comment"
    }
});
