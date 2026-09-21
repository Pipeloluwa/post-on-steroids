import './polyfills.server.mjs';
import{b as $}from"./chunk-OAYK3NXA.mjs";import{a as Q,n as q}from"./chunk-MOSORSXX.mjs";import{A as w,Ca as R,Da as L,E as u,Fa as V,Ga as F,Ha as D,K as E,L as S,Ma as c,Na as l,Pa as M,Qa as B,Ra as T,Sa as y,Ta as v,U as h,Vb as z,Wa as N,Xa as O,Ya as A,Yb as C,aa as I,ab as W,cb as j,db as H,fb as K,ha as k,ia as a,nb as U,pa as P,wb as d,yb as b,z as _,zb as p}from"./chunk-C4ONI7GI.mjs";var G=class i{platformId=u(I);iframe=null;messageListener=null;constructor(){C(this.platformId)&&this.initializeSandbox()}readyPromise;initializeSandbox(){this.readyPromise=new Promise(n=>{this.iframe=document.createElement("iframe"),this.iframe.setAttribute("sandbox","allow-scripts"),this.iframe.style.display="none",this.iframe.onload=()=>n(),document.body.appendChild(this.iframe);let t="<!DOCTYPE html><html><head><script>"+`
window.addEventListener("message", async (event) => {
  const { id, code, context } = event.data;
  if (!id) return;

  let logs = [];
  const originalConsoleLog = console.log;
  console.log = (...args) => {
    logs.push(args.map(a => typeof a === "object" ? JSON.stringify(a, null, 2) : String(a)).join(" "));
    originalConsoleLog(...args);
  };

  let pm = { ...context };

  try {
    const contextKeys = Object.keys(context);
    
    // Declare all context keys as local variables
    const paramDeclarations = contextKeys.map(k => 
      "let " + k + " = context['" + k + "'];"
    ).join(String.fromCharCode(10));

    // Write back any mutations to pm
    const paramWriteBack = contextKeys.map(k => 
      "pm['" + k + "'] = " + k + ";"
    ).join(String.fromCharCode(10));

    let testResults = [];
    let testPassed = true;
    const test = (name, fn) => {
      try {
        const res = typeof fn === 'function' ? fn() : fn;
        if (res === false) {
          testResults.push({ name, passed: false, error: 'Assertion failed' });
          testPassed = false;
        } else {
          testResults.push({ name, passed: true });
        }
      } catch (err) {
        testResults.push({ name, passed: false, error: String(err) });
        testPassed = false;
      }
    };

    const fnBodyLines = [
      "return (async () => {",
      paramDeclarations,
      code,
      "if (typeof preScript === 'function') { const _preReturn = await preScript(headers, body, params); if (_preReturn !== undefined) { body = _preReturn; } }",
      "if (typeof postScript === 'function') { await postScript(responseHeaders || responseHeader, responseBody, headers, body, params); }",
      "if (typeof testScript === 'function') { const _testReturn = await testScript(responseStatus, responseTime, responseBody, responseHeaders || responseHeader); if (_testReturn !== undefined) { testPassed = !!_testReturn; } }",
      "if (typeof encryptScript === 'function') { const _encReturn = await encryptScript(headers, body, params, encryptedHeaders, encryptedBodyPaths); if (_encReturn !== undefined) { body = _encReturn; } }",
      paramWriteBack,
      "})();"
    ];
    const fnBody = fnBodyLines.join(String.fromCharCode(10));
      
    const executeInSandbox = new Function("pm", "context", "test", fnBody);
    await executeInSandbox(pm, context, test);

    // Extract test results from PASS/FAIL console logs if any
    for (const log of logs) {
      const match = log.match(/^(PASS|FAIL):s*(.*)/i);
      if (match) {
        const logName = match[2].trim();
        if (!testResults.some(t => t.name === logName)) {
          testResults.push({
            name: logName,
            passed: match[1].toUpperCase() === 'PASS'
          });
        }
      }
    }

    pm['testResults'] = testResults;
    pm['testPassed'] = testPassed;

    parent.postMessage({ id, success: true, context: pm, logs: logs.join("\\n") }, "*");
  } catch (err) {
    parent.postMessage({ id, success: false, error: err.toString(), logs: logs.join("\\n") }, "*");
  } finally {
    console.log = originalConsoleLog;
  }
});`+"</script></head><body></body></html>",s=new Blob([t],{type:"text/html"});this.iframe.src=URL.createObjectURL(s)})}async executeScript(n,e){return C(this.platformId)?(await this.readyPromise,new Promise(t=>{if(!this.iframe?.contentWindow){t({success:!1,error:"Sandbox not available",context:e});return}let s=crypto.randomUUID(),o=r=>{r.data?.id===s&&(window.removeEventListener("message",o),t({success:r.data.success,error:r.data.error,logs:r.data.logs,context:r.data.context}))};window.addEventListener("message",o),this.iframe.contentWindow.postMessage({id:s,code:n,context:e},"*"),setTimeout(()=>{window.removeEventListener("message",o),t({success:!1,error:"Execution timeout (5000ms)",context:e})},5e3)})):{success:!1,error:"Sandbox not available",context:e}}ngOnDestroy(){this.iframe&&this.iframe.parentNode&&this.iframe.parentNode.removeChild(this.iframe)}static \u0275fac=function(e){return new(e||i)};static \u0275prov=w({token:i,factory:i.\u0275fac,providedIn:"root"})};var ee=["inputField"];function te(i,n){if(i&1){let e=M();c(0,"li",7),y("mousedown",function(s){let o=E(e).$implicit,r=v(2);return s.preventDefault(),S(r.setSuggestion(o))}),H(1),l()}if(i&2){let e=n.$implicit;a(),K(" ",e," ")}}function ne(i,n){if(i&1&&(c(0,"div",4)(1,"ul",5),F(2,te,2,1,"li",6,V),l()()),i&2){let e=v();W("left",e.cursorOffset(),"px")("width",150,"px"),a(2),D(e.suggestions())}}var J=class i{variableService=u($);placeholder=p("");customClass=p("");type=p("text");value=h("");currentCursorIndex=h(0);variableKeys=d(()=>this.variableService.variables().map(n=>n.key));onChange=()=>{};onTouch=()=>{};enter=b();pasteEvent=b();inputField;suggestions=d(()=>{let n=this.value(),e=this.currentCursorIndex(),t=n.substring(0,e),s=t.lastIndexOf("{{"),o=t.lastIndexOf("}}");if(s!==-1&&s>=o){let r=t.substring(s+2);return this.variableKeys().filter(m=>m.toLowerCase().includes(r.toLowerCase()))}return[]});cursorOffset=d(()=>{let s=12+this.currentCursorIndex()*6.5;if(this.inputField?.nativeElement){let o=this.inputField.nativeElement.offsetWidth;if(o>0&&s+150>o)return Math.max(0,o-150-10)}return s});writeValue(n){this.value.set(n||"")}registerOnChange(n){this.onChange=n}registerOnTouched(n){this.onTouch=n}onInput(n){let t=n.target.value;this.value.set(t),this.onChange(t),this.updateCursorPosition()}onKeyDown(n){n.key==="Enter"&&this.enter.emit()}updateCursorPosition(){requestAnimationFrame(()=>{this.inputField?.nativeElement&&this.currentCursorIndex.set(this.inputField.nativeElement.selectionStart??0)})}onDocumentClick(n){this.inputField?.nativeElement.contains(n.target)}setSuggestion(n){let e=this.value(),t=this.currentCursorIndex(),s=e.substring(0,t),o=e.substring(t),r=s.lastIndexOf("{{");if(r!==-1){let m=e.substring(0,r+2),Y=o.startsWith("}}"),X=o.startsWith("}"),f="}}";Y?f="":X&&(f="}");let x=m+n+f+o;this.value.set(x),this.onChange(x);let g=r+2+n.length+2;requestAnimationFrame(()=>{this.inputField?.nativeElement&&(this.inputField.nativeElement.focus(),this.inputField.nativeElement.setSelectionRange(g,g),this.currentCursorIndex.set(g))})}}static \u0275fac=function(e){return new(e||i)};static \u0275cmp=P({type:i,selectors:[["app-variable-input"]],viewQuery:function(e,t){if(e&1&&N(ee,5),e&2){let s;O(s=A())&&(t.inputField=s.first)}},hostAttrs:[1,"w-full","block","relative"],hostBindings:function(e,t){e&1&&T("click",function(o){return t.onDocumentClick(o)},k)},inputs:{placeholder:[1,"placeholder"],customClass:[1,"customClass"],type:[1,"type"]},outputs:{enter:"enter",pasteEvent:"pasteEvent"},features:[U([{provide:Q,useExisting:_(()=>i),multi:!0}])],decls:4,vars:6,consts:[["inputField",""],[1,"relative","w-full","h-full","flex","items-center"],[3,"input","keyup","click","keydown","paste","type","value","placeholder"],[1,"absolute","top-full","mt-1","left-0","bg-(--postonsteroids-bg-secondary)","border","border-(--postonsteroids-border)","rounded-md","shadow-lg","z-50","max-h-[250px]","overflow-y-auto",3,"left","width"],[1,"absolute","top-full","mt-1","left-0","bg-(--postonsteroids-bg-secondary)","border","border-(--postonsteroids-border)","rounded-md","shadow-lg","z-50","max-h-[250px]","overflow-y-auto"],[1,"flex","flex-col","py-1"],[1,"px-3","py-1.5","text-sm","text-(--postonsteroids-text-primary)","hover:bg-(--postonsteroids-bg-hover)","cursor-pointer","font-mono","truncate"],[1,"px-3","py-1.5","text-sm","text-(--postonsteroids-text-primary)","hover:bg-(--postonsteroids-bg-hover)","cursor-pointer","font-mono","truncate",3,"mousedown"]],template:function(e,t){e&1&&(c(0,"div",1)(1,"input",2,0),y("input",function(o){return t.onInput(o)})("keyup",function(){return t.updateCursorPosition()})("click",function(){return t.updateCursorPosition()})("keydown",function(o){return t.onKeyDown(o)})("paste",function(o){return t.pasteEvent.emit(o)}),l(),R(3,ne,4,4,"div",3),l()),e&2&&(a(),j(t.customClass()),B("type",t.type())("value",t.value())("placeholder",t.placeholder()),a(2),L(t.suggestions().length>0?3:-1))},dependencies:[z,q],encapsulation:2})};export{G as a,J as b};
