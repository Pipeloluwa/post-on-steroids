
const json = `{
  // comment
  "url": "http://example.com", // another comment
  "text": "hello \\"world\\" // not a comment",
  /* block comment 
  line 2 */
  "prop": 123
}`;
const stripped = json.replace(/"(?:[^"\\]|\\.)*"|(\/\/.*|\/\*[\s\S]*?\*\/)/g, (m, g) => g ? "" : m);
console.log(stripped);

