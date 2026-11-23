import type { ScriptLanguage } from '../constants/script.snippets.constants';

export function detectScriptLanguage(code: string, explicit?: ScriptLanguage): ScriptLanguage {
    if (explicit === 'python' || explicit === 'javascript') {
        return explicit;
    }
    const text = (code || '').trim();
    if (!text) return 'javascript';

    // Explicit Python function definitions without JS function syntax
    if (/^\s*(?:async\s+)?def\s+[A-Za-z_]\w*\s*\([^)]*\)\s*:/m.test(text) && !/\bfunction\s+[A-Za-z_$]\w*\s*\(/.test(text)) {
        return 'python';
    }
    // Python-specific syntax markers (elif:, except:, # comment header + def, True/False/None)
    if (/^\s*(?:elif\s+.+|else|except(?:\s+[^:]+)?|finally)\s*:/m.test(text) && !/;\s*$/m.test(text)) {
        return 'python';
    }
    if (/^\s*from\s+[A-Za-z_][\w.]*\s+import\s+/m.test(text)) {
        return 'python';
    }
    return 'javascript';
}

interface ExtractedStringToken {
    placeholder: string;
    jsExpr: string;
}

function splitTopLevelCommas(input: string): string[] {
    const parts: string[] = [];
    let current = '';
    let depth = 0;
    let quote: string | null = null;
    for (let i = 0; i < input.length; i++) {
        const ch = input[i];
        const prev = i > 0 ? input[i - 1] : '';
        if (quote) {
            current += ch;
            if (ch === quote && prev !== '\\') quote = null;
            continue;
        }
        if (ch === '"' || ch === "'" || ch === '`') {
            quote = ch;
            current += ch;
            continue;
        }
        if (ch === '(' || ch === '[' || ch === '{') depth++;
        else if (ch === ')' || ch === ']' || ch === '}') depth = Math.max(0, depth - 1);
        else if (ch === ',' && depth === 0) {
            parts.push(current.trim());
            current = '';
            continue;
        }
        current += ch;
    }
    if (current.trim()) parts.push(current.trim());
    return parts;
}

function findMatchingQuoteEnd(src: string, start: number, delim: string): number {
    if (delim.length === 3) {
        const idx = src.indexOf(delim, start + 3);
        return idx === -1 ? src.length : idx + 3;
    }
    for (let i = start + 1; i < src.length; i++) {
        if (src[i] === '\\') {
            i++;
            continue;
        }
        if (src[i] === delim || src[i] === '\n') {
            return src[i] === delim ? i + 1 : i;
        }
    }
    return src.length;
}

function convertFStringBody(inner: string): string {
    let out = '`';
    for (let i = 0; i < inner.length; i++) {
        const ch = inner[i];
        if (ch === '{' && inner[i + 1] === '{') {
            out += '{';
            i++;
            continue;
        }
        if (ch === '}' && inner[i + 1] === '}') {
            out += '}';
            i++;
            continue;
        }
        if (ch === '{') {
            let depth = 1;
            let j = i + 1;
            let q: string | null = null;
            while (j < inner.length && depth > 0) {
                const c = inner[j];
                if (q) {
                    if (c === '\\') { j += 2; continue; }
                    if (c === q) q = null;
                } else {
                    if (c === '"' || c === "'") q = c;
                    else if (c === '{') depth++;
                    else if (c === '}') depth--;
                }
                j++;
            }
            const exprRaw = inner.slice(i + 1, j - 1);
            // Support optional format spec like {x:.2f} by trimming trailing format spec outside quotes/brackets
            const cleanExpr = stripFStringFormatSpec(exprRaw);
            out += '${' + transformPyExpressionRaw(cleanExpr) + '}';
            i = j - 1;
            continue;
        }
        if (ch === '`') {
            out += '\\`';
        } else if (ch === '$' && inner[i + 1] === '{') {
            out += '\\${';
            i++;
        } else {
            out += ch;
        }
    }
    return out + '`';
}

function stripFStringFormatSpec(expr: string): string {
    let depth = 0;
    let q: string | null = null;
    for (let i = 0; i < expr.length; i++) {
        const c = expr[i];
        if (q) {
            if (c === '\\') { i++; continue; }
            if (c === q) q = null;
            continue;
        }
        if (c === '"' || c === "'") q = c;
        else if (c === '(' || c === '[' || c === '{') depth++;
        else if (c === ')' || c === ']' || c === '}') depth = Math.max(0, depth - 1);
        else if (c === ':' && depth === 0) {
            return expr.slice(0, i).trim();
        }
    }
    return expr.trim();
}

function extractStringsAndComments(code: string): { masked: string; tokens: ExtractedStringToken[] } {
    const tokens: ExtractedStringToken[] = [];
    let out = '';
    let i = 0;

    while (i < code.length) {
        const ch = code[i];

        // Comments outside strings
        if (ch === '#') {
            while (i < code.length && code[i] !== '\n') i++;
            continue;
        }

        // Prefix r / f / b strings
        const next1 = code[i + 1] || '';
        const next2 = code[i + 2] || '';
        const isPrefixed =
            /[rfbuRFBU]/.test(ch) &&
            (i === 0 || !/[A-Za-z0-9_$]/.test(code[i - 1])) &&
            (next1 === '"' || next1 === "'" || (/[rfbuRFBU]/.test(next1) && (next2 === '"' || next2 === "'")));

        if (ch === '"' || ch === "'" || isPrefixed) {
            let prefix = '';
            let qStart = i;
            if (isPrefixed) {
                if (/[rfbuRFBU]/.test(next1) && (next2 === '"' || next2 === "'")) {
                    prefix = (ch + next1).toLowerCase();
                    qStart = i + 2;
                } else {
                    prefix = ch.toLowerCase();
                    qStart = i + 1;
                }
            }
            const qChar = code[qStart];
            const isTriple = code.slice(qStart, qStart + 3) === qChar.repeat(3);
            const delim = isTriple ? qChar.repeat(3) : qChar;
            const end = findMatchingQuoteEnd(code, qStart, delim);
            const rawLiteral = code.slice(qStart, end);
            const inner = isTriple
                ? rawLiteral.slice(3, rawLiteral.endsWith(delim) ? rawLiteral.length - 3 : rawLiteral.length)
                : rawLiteral.slice(1, rawLiteral.endsWith(qChar) ? rawLiteral.length - 1 : rawLiteral.length);

            let jsExpr: string;
            if (prefix.includes('f')) {
                jsExpr = convertFStringBody(inner);
            } else if (prefix.includes('r') || isTriple) {
                jsExpr = JSON.stringify(inner);
            } else {
                // Convert single/double quoted Python string cleanly to JS string preserving escapes
                jsExpr = qChar === '"' ? rawLiteral : '"' + inner.replace(/\\/g, '\\\\').replace(/\\\\(["'ntr0bfvxu\\])/g, '\\$1').replace(/"/g, '\\"') + '"';
                if (qChar === "'") {
                    jsExpr = rawLiteral;
                }
            }

            const placeholder = `__PY_STR_${tokens.length}__`;
            tokens.push({ placeholder, jsExpr });
            out += placeholder;
            i = end;
            continue;
        }

        out += ch;
        i++;
    }

    return { masked: out, tokens };
}

function restorePlaceholders(expr: string, tokens: ExtractedStringToken[]): string {
    return expr.replace(/__PY_STR_(\d+)__/g, (_, idx) => tokens[Number(idx)]?.jsExpr ?? '""');
}

function joinLogicalLines(maskedCode: string): Array<{ indent: number; text: string }> {
    const physicalLines = maskedCode.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    const logical: Array<{ indent: number; text: string }> = [];

    let buffer = '';
    let bufferIndent = 0;
    let bracketDepth = 0;
    let inContinuation = false;

    for (const rawLine of physicalLines) {
        const leadingMatch = rawLine.match(/^([ \t]*)/);
        const leading = leadingMatch ? leadingMatch[1].replace(/\t/g, '    ') : '';
        let content = rawLine.slice(leadingMatch ? leadingMatch[1].length : 0).trimEnd();
        const hasLineContinuation = content.endsWith('\\');
        if (hasLineContinuation) {
            content = content.slice(0, -1).trimEnd();
        }

        if (!content.trim() && bracketDepth === 0 && !inContinuation) {
            continue;
        }

        if (!buffer) {
            bufferIndent = leading.length;
            buffer = content.trim();
        } else if (content.trim()) {
            buffer += ' ' + content.trim();
        }

        for (const ch of content) {
            if (ch === '(' || ch === '[' || ch === '{') bracketDepth++;
            else if (ch === ')' || ch === ']' || ch === '}') bracketDepth = Math.max(0, bracketDepth - 1);
        }

        inContinuation = hasLineContinuation;
        if (bracketDepth === 0 && !inContinuation) {
            if (buffer.trim()) {
                logical.push({ indent: bufferIndent, text: buffer.trim() });
            }
            buffer = '';
        }
    }

    if (buffer.trim()) {
        logical.push({ indent: bufferIndent, text: buffer.trim() });
    }

    return logical;
}

function splitTopLevelKeyword(expr: string, keyword: 'or' | 'and'): string[] | null {
    const parts: string[] = [];
    let depth = 0;
    let last = 0;
    const kwLen = keyword.length;

    for (let i = 0; i < expr.length; i++) {
        const ch = expr[i];
        if (ch === '(' || ch === '[' || ch === '{') { depth++; continue; }
        if (ch === ')' || ch === ']' || ch === '}') { depth = Math.max(0, depth - 1); continue; }
        if (depth === 0 && expr.slice(i, i + kwLen) === keyword) {
            const before = i > 0 ? expr[i - 1] : ' ';
            const after = expr[i + kwLen] || ' ';
            if (/[\s()\]}]/.test(before) && /[\s(\[{!~+-]/.test(after) && !/[A-Za-z0-9_$]/.test(before) && !/[A-Za-z0-9_$]/.test(after)) {
                parts.push(expr.slice(last, i).trim());
                last = i + kwLen;
                i += kwLen - 1;
            }
        }
    }
    if (parts.length === 0) return null;
    parts.push(expr.slice(last).trim());
    return parts.every(Boolean) ? parts : null;
}

function findTopLevelComparisonKeyword(expr: string): { idx: number; len: number; op: 'not in' | 'in' | 'is not' | 'is' } | null {
    let depth = 0;
    const ops: Array<'not in' | 'is not' | 'in' | 'is'> = ['not in', 'is not', 'in', 'is'];

    for (let i = 0; i < expr.length; i++) {
        const ch = expr[i];
        if (ch === '(' || ch === '[' || ch === '{') { depth++; continue; }
        if (ch === ')' || ch === ']' || ch === '}') { depth = Math.max(0, depth - 1); continue; }
        if (depth !== 0) continue;

        for (const op of ops) {
            if (expr.startsWith(op, i)) {
                const before = i > 0 ? expr[i - 1] : '';
                const after = expr[i + op.length] || '';
                if (/\s|[)\]]/.test(before) && /\s|[(\[{'"]/.test(after)) {
                    return { idx: i, len: op.length, op };
                }
            }
        }
    }
    return null;
}

function transformDelimitedSubExpressions(expr: string): string {
    // Recursively transform inside balanced (...) and [...] without breaking object literals {...}
    let out = '';
    let i = 0;
    while (i < expr.length) {
        const ch = expr[i];
        if (ch === '[' || ch === '(') {
            const closeCh = ch === '[' ? ']' : ')';
            let depth = 1;
            let j = i + 1;
            while (j < expr.length && depth > 0) {
                if (expr[j] === ch) depth++;
                else if (expr[j] === closeCh) depth--;
                j++;
            }
            const inner = expr.slice(i + 1, j - 1);

            if (ch === '[') {
                // Check for Python list comprehension inside [...]
                const compMatch = matchTopLevelComprehension(inner);
                if (compMatch) {
                    const iterJs = transformPyExpressionRaw(compMatch.iterExpr);
                    const bodyJs = transformPyExpressionRaw(compMatch.bodyExpr);
                    const arg = compMatch.varExpr.includes(',') ? `[${compMatch.varExpr}]` : compMatch.varExpr;
                    if (compMatch.filterExpr) {
                        const condJs = transformPyExpressionRaw(compMatch.filterExpr);
                        out += `__py.iter(${iterJs}).filter((${arg}) => __py.truthy(${condJs})).map((${arg}) => (${bodyJs}))`;
                    } else {
                        out += `__py.iter(${iterJs}).map((${arg}) => (${bodyJs}))`;
                    }
                    i = j;
                    continue;
                }

                // Check for Python slice target[start:end] (only when preceded by an identifier/)/])
                const prevTrimmed = out.trimEnd();
                if (/[A-Za-z0-9_$)\]]$/.test(prevTrimmed) && hasTopLevelColon(inner)) {
                    const colonPos = findTopLevelColon(inner);
                    const startExpr = inner.slice(0, colonPos).trim();
                    const endExpr = inner.slice(colonPos + 1).trim();
                    // Extract the immediately preceding chain `foo.bar` or `arr`
                    const targetMatch = prevTrimmed.match(/([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)$/);
                    if (targetMatch) {
                        const prefixStart = prevTrimmed.length - targetMatch[1].length;
                        out = prevTrimmed.slice(0, prefixStart) +
                            `__py.slice(${targetMatch[1]}, ${startExpr ? transformPyExpressionRaw(startExpr) : 'null'}, ${endExpr ? transformPyExpressionRaw(endExpr) : 'null'})`;
                        i = j;
                        continue;
                    }
                }

                const items = splitTopLevelCommas(inner).map(p => transformPyExpressionRaw(p));
                out += `[${items.join(', ')}]`;
                i = j;
                continue;
            }

            // Parentheses `(a, b)` -> distinguish callable args `fn(a, b)` vs grouping `(a || b)` vs Python tuple `(dict, list)`
            const isCallArgs = /[A-Za-z0-9_$\])]\s*$/.test(out);
            if (!inner.trim()) {
                out += '()';
            } else {
                const parts = splitTopLevelCommas(inner).map(p => transformPyExpressionRaw(p));
                if (!isCallArgs && parts.length > 1) {
                    out += `[${parts.join(', ')}]`;
                } else {
                    out += `(${parts.join(', ')})`;
                }
            }
            i = j;
            continue;
        }

        out += ch;
        i++;
    }
    return out;
}

function matchTopLevelComprehension(inner: string): { bodyExpr: string; varExpr: string; iterExpr: string; filterExpr?: string } | null {
    let depth = 0;
    let forIdx = -1;
    let inIdx = -1;
    let ifIdx = -1;

    for (let i = 0; i < inner.length; i++) {
        const ch = inner[i];
        if (ch === '(' || ch === '[' || ch === '{') depth++;
        else if (ch === ')' || ch === ']' || ch === '}') depth = Math.max(0, depth - 1);
        else if (depth === 0) {
            if (forIdx === -1 && /^\s+for\s+/.test(inner.slice(i))) {
                forIdx = i;
            } else if (forIdx !== -1 && inIdx === -1 && /^\s+in\s+/.test(inner.slice(i))) {
                inIdx = i;
            } else if (inIdx !== -1 && ifIdx === -1 && /^\s+if\s+/.test(inner.slice(i))) {
                ifIdx = i;
                break;
            }
        }
    }
    if (forIdx === -1 || inIdx === -1) return null;
    const bodyExpr = inner.slice(0, forIdx).trim();
    const afterFor = inner.slice(forIdx).replace(/^\s+for\s+/, '');
    const varLen = inIdx - (inner.length - afterFor.length);
    const varExpr = afterFor.slice(0, varLen).trim();
    const afterIn = inner.slice(inIdx).replace(/^\s+in\s+/, '');
    if (ifIdx !== -1) {
        const iterLen = ifIdx - (inner.length - afterIn.length);
        return {
            bodyExpr,
            varExpr,
            iterExpr: afterIn.slice(0, iterLen).trim(),
            filterExpr: inner.slice(ifIdx).replace(/^\s+if\s+/, '').trim()
        };
    }
    return { bodyExpr, varExpr, iterExpr: afterIn.trim() };
}

function findTopLevelColon(expr: string): number {
    let depth = 0;
    for (let i = 0; i < expr.length; i++) {
        const ch = expr[i];
        if (ch === '(' || ch === '[' || ch === '{') depth++;
        else if (ch === ')' || ch === ']' || ch === '}') depth = Math.max(0, depth - 1);
        else if (ch === ':' && depth === 0) return i;
    }
    return -1;
}

function hasTopLevelColon(expr: string): boolean {
    return findTopLevelColon(expr) !== -1;
}

function rewritePyMethodCalls(expr: string): string {
    const pyMethods = new Set([
        'get', 'items', 'keys', 'values', 'update', 'pop', 'setdefault',
        'append', 'extend',
        'strip', 'lstrip', 'rstrip', 'upper', 'lower', 'startswith', 'endswith', 'join'
    ]);
    let s = expr;
    let idx = 0;

    while (idx < s.length) {
        const dotIdx = s.indexOf('.', idx);
        if (dotIdx === -1) break;

        const afterDot = s.slice(dotIdx + 1);
        const mMatch = afterDot.match(/^([A-Za-z_]\w*)\s*\(/);
        if (!mMatch || !pyMethods.has(mMatch[1])) {
            idx = dotIdx + 1;
            continue;
        }

        const methodName = mMatch[1];
        const openParenIdx = dotIdx + 1 + mMatch[0].length - 1;
        // Find matching closing paren
        let pDepth = 1;
        let closeParenIdx = openParenIdx + 1;
        while (closeParenIdx < s.length && pDepth > 0) {
            if (s[closeParenIdx] === '(') pDepth++;
            else if (s[closeParenIdx] === ')') pDepth--;
            closeParenIdx++;
        }
        if (pDepth !== 0) {
            idx = dotIdx + 1;
            continue;
        }
        const argsStr = s.slice(openParenIdx + 1, closeParenIdx - 1).trim();

        // Walk backward from dotIdx to find the start of the receiver expression
        let rStart = dotIdx - 1;
        while (rStart >= 0 && /\s/.test(s[rStart])) rStart--;
        if (rStart < 0) {
            idx = dotIdx + 1;
            continue;
        }

        let pos = rStart;
        while (pos >= 0) {
            const ch = s[pos];
            if (ch === ')' || ch === ']') {
                const open = ch === ')' ? '(' : '[';
                let d = 1;
                pos--;
                while (pos >= 0 && d > 0) {
                    if (s[pos] === ch) d++;
                    else if (s[pos] === open) d--;
                    pos--;
                }
                continue;
            }
            if (/[A-Za-z0-9_$]/.test(ch)) {
                pos--;
                continue;
            }
            if (ch === '.') {
                pos--;
                continue;
            }
            break;
        }

        // Handle case where receiver ends right at an opening brace/space boundary
        const recvStart = pos + 1;
        const receiver = s.slice(recvStart, dotIdx).trim();
        if (!receiver || receiver === '__py' || receiver === '__py.modules') {
            idx = dotIdx + 1;
            continue;
        }

        const rewrittenArgs = argsStr ? rewritePyMethodCalls(argsStr) : '';
        const replacement = rewrittenArgs
            ? `__py.${methodName}(${receiver}, ${rewrittenArgs})`
            : `__py.${methodName}(${receiver})`;
        s = s.slice(0, recvStart) + replacement + s.slice(closeParenIdx);
        idx = recvStart + replacement.length;
    }

    return s;
}

function transformPyExpressionRaw(expr: string): string {
    let s = (expr || '').trim();
    if (!s) return s;

    // Mask inline strings when called standalone (e.g. inside f-strings or nested helpers)
    if (!/__PY_STR_\d+__/.test(s) && /["']/.test(s)) {
        const { masked, tokens } = extractStringsAndComments(s);
        return restorePlaceholders(transformPyExpressionRaw(masked), tokens);
    }

    // 1. Inline ternary: A if COND else B
    const ternaryMatch = matchTopLevelTernary(s);
    if (ternaryMatch) {
        const aJs = transformPyExpressionRaw(ternaryMatch.trueExpr);
        const condJs = transformPyExpressionRaw(ternaryMatch.condExpr);
        const bJs = transformPyExpressionRaw(ternaryMatch.falseExpr);
        return `(__py.truthy(${condJs}) ? (${aJs}) : (${bJs}))`;
    }

    // 2. Top-level `or` / `and`
    const orParts = splitTopLevelKeyword(s, 'or');
    if (orParts) {
        return orParts.map(p => transformPyExpressionRaw(p)).join(' || ');
    }
    const andParts = splitTopLevelKeyword(s, 'and');
    if (andParts) {
        return andParts.map(p => transformPyExpressionRaw(p)).join(' && ');
    }

    // 3. Leading `await <expr>`
    if (/^await\s+/.test(s)) {
        return `await ${transformPyExpressionRaw(s.replace(/^await\s+/, ''))}`;
    }

    // 4. Leading unary `not <expr>`
    if (/^not\s+/.test(s)) {
        return `!__py.truthy(${transformPyExpressionRaw(s.replace(/^not\s+/, ''))})`;
    }

    // 5. Membership & identity operators at depth 0 (`not in`, `in`, `is not`, `is`)
    const cmpKw = findTopLevelComparisonKeyword(s);
    if (cmpKw) {
        const leftJs = transformPyExpressionRaw(s.slice(0, cmpKw.idx).trim());
        const rightJs = transformPyExpressionRaw(s.slice(cmpKw.idx + cmpKw.len).trim());
        if (cmpKw.op === 'not in') return `(!__py.contains(${rightJs}, ${leftJs}))`;
        if (cmpKw.op === 'in') return `__py.contains(${rightJs}, ${leftJs})`;
        if (cmpKw.op === 'is not') return `(${leftJs} !== ${rightJs})`;
        return `(${leftJs} === ${rightJs})`;
    }

    // 6. Chained numeric comparison like 200 <= status < 300
    s = s.replace(
        /^(\d+(?:\.\d+)?)\s*(<=|<)\s*(.+?)\s*(<=|<)\s*(\d+(?:\.\d+)?)$/,
        (_, left, op1, mid, op2, right) => {
            const midJs = transformPyExpressionRaw(mid);
            return `((${left} ${op1} ${midJs}) && (${midJs} ${op2} ${right}))`;
        }
    );

    // 7. Transform delimited (...) and [...] sub-expressions
    s = transformDelimitedSubExpressions(s);

    // 8. Rewrite Python dict/list/string method calls cleanly without mutating Object.prototype
    s = rewritePyMethodCalls(s);

    // 9. Python literals
    s = s
        .replace(/\bTrue\b/g, 'true')
        .replace(/\bFalse\b/g, 'false')
        .replace(/\bNone\b/g, 'null');

    return s;
}

function matchTopLevelTernary(expr: string): { trueExpr: string; condExpr: string; falseExpr: string } | null {
    let depth = 0;
    let ifIdx = -1;
    let elseIdx = -1;

    for (let i = 0; i < expr.length; i++) {
        const ch = expr[i];
        if (ch === '(' || ch === '[' || ch === '{') depth++;
        else if (ch === ')' || ch === ']' || ch === '}') depth = Math.max(0, depth - 1);
        else if (depth === 0) {
            if (ifIdx === -1 && /\s+if\s+/.test(expr.slice(i)) && expr.slice(i).match(/^\s+if\s+/)) {
                ifIdx = i;
            } else if (ifIdx !== -1 && /^\s+else\s+/.test(expr.slice(i))) {
                elseIdx = i;
                break;
            }
        }
    }

    if (ifIdx === -1 || elseIdx === -1) return null;
    const trueExpr = expr.slice(0, ifIdx).trim();
    const afterIf = expr.slice(ifIdx).replace(/^\s+if\s+/, '');
    const condLen = elseIdx - (expr.length - afterIf.length);
    const condExpr = afterIf.slice(0, condLen).trim();
    const falseExpr = expr.slice(elseIdx).replace(/^\s+else\s+/, '').trim();
    if (!trueExpr || !condExpr || !falseExpr) return null;
    return { trueExpr, condExpr, falseExpr };
}

function stripParamDefaultsAndTypes(rawParams: string): { jsParams: string; paramNames: string[] } {
    const parts = splitTopLevelCommas(rawParams);
    const jsParams: string[] = [];
    const paramNames: string[] = [];

    for (const part of parts) {
        if (!part) continue;
        // Strip leading * / **
        let p = part.replace(/^\*{1,2}/, '').trim();
        // Split off default value if present outside type annotation
        const eqIdx = p.indexOf('=');
        let defaultVal = '';
        if (eqIdx !== -1) {
            defaultVal = p.slice(eqIdx + 1).trim();
            p = p.slice(0, eqIdx).trim();
        }
        // Strip type annotation (: str)
        const colonIdx = p.indexOf(':');
        if (colonIdx !== -1) {
            p = p.slice(0, colonIdx).trim();
        }
        if (/^[A-Za-z_]\w*$/.test(p)) {
            paramNames.push(p);
            jsParams.push(defaultVal ? `${p} = ${transformPyExpressionRaw(defaultVal)}` : p);
        }
    }

    return { jsParams: jsParams.join(', '), paramNames };
}

interface ScopeInfo {
    indent: number;
    kind: 'root' | 'def' | 'block';
    declared: Set<string>;
    lines: string[];
}

export function transpilePythonToJs(pyCode: string): string {
    const { masked, tokens } = extractStringsAndComments(pyCode || '');
    const logicalLines = joinLogicalLines(masked);

    const reservedGlobalAssigns = new Set([
        'headers', 'body', 'params', 'bodyType', 'body_type', 'rawType', 'raw_type',
        'formData', 'form_data', 'urlEncodedData', 'url_encoded_data', 'graphql', 'rawText', 'raw_text',
        'responseStatus', 'response_status', 'responseTime', 'response_time',
        'responseBody', 'response_body', 'responseHeaders', 'response_headers', 'responseHeader',
        'encryptedHeaders', 'encrypted_headers', 'encryptedBodyPaths', 'encrypted_body_paths',
        'encryptedFormData', 'encrypted_form_data', 'encryptedUrlEncodedData', 'encrypted_url_encoded_data',
        'encryptedGraphqlPaths', 'encrypted_graphql_paths', 'encryptRawText', 'encrypt_raw_text',
        'environment', 'variables', 'pm', 'postman'
    ]);

    const scopeStack: ScopeInfo[] = [
        { indent: 0, kind: 'root', declared: new Set(reservedGlobalAssigns), lines: [] }
    ];
    const indentStack: Array<{ indent: number; kind: 'def' | 'block'; closing?: string }> = [];

    const currentFnScope = (): ScopeInfo => {
        for (let i = scopeStack.length - 1; i >= 0; i--) {
            if (scopeStack[i].kind === 'def' || scopeStack[i].kind === 'root') return scopeStack[i];
        }
        return scopeStack[0];
    };

    const emitLine = (line: string) => {
        currentFnScope().lines.push(line);
    };

    const declareLocal = (name: string) => {
        const fnScope = currentFnScope();
        if (!fnScope.declared.has(name)) {
            fnScope.declared.add(name);
            // Hoisted as `let name;` at top of fnScope
            fnScope.lines.unshift(`let ${name};`);
        }
    };

    const closeTopBlock = () => {
        const popped = indentStack.pop();
        if (!popped) return;
        if (popped.kind === 'def') {
            const finishedScope = scopeStack.pop()!;
            const parent = currentFnScope();
            for (const l of finishedScope.lines) {
                parent.lines.push('  ' + l);
            }
            parent.lines.push(popped.closing || '}');
        } else {
            emitLine(popped.closing || '}');
        }
    };

    for (let i = 0; i < logicalLines.length; i++) {
        const { indent, text } = logicalLines[i];

        while (indentStack.length > 0 && indent <= indentStack[indentStack.length - 1].indent) {
            // Keep open when matching elif/else/except/finally at the exact same indent!
            const isContinuationBranch =
                indent === indentStack[indentStack.length - 1].indent &&
                /^(?:elif\s+.+|else|except(?:\s+[^:]+)?|finally)\s*:/.test(text);
            if (isContinuationBranch) {
                const branchBlock = indentStack.pop()!;
                if (branchBlock.kind === 'def') {
                    scopeStack.pop();
                }
                break;
            }
            closeTopBlock();
        }

        // 1. Block statements ending cleanly in ':'
        const defMatch = text.match(/^(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*(?:->\s*[^:]+)?:\s*$/);
        if (defMatch) {
            const fnName = defMatch[1];
            const { jsParams, paramNames } = stripParamDefaultsAndTypes(defMatch[2]);
            emitLine(`async function ${fnName}(${jsParams}) {`);
            const fnScope: ScopeInfo = {
                indent,
                kind: 'def',
                declared: new Set([...reservedGlobalAssigns, ...paramNames]),
                lines: []
            };
            scopeStack.push(fnScope);
            indentStack.push({ indent, kind: 'def', closing: '}' });
            continue;
        }

        const elifMatch = text.match(/^elif\s+(.+):\s*$/);
        if (elifMatch) {
            emitLine(`} else if (__py.truthy(${transformPyExpressionRaw(elifMatch[1])})) {`);
            indentStack.push({ indent, kind: 'block', closing: '}' });
            continue;
        }

        if (/^else\s*:\s*$/.test(text)) {
            emitLine(`} else {`);
            indentStack.push({ indent, kind: 'block', closing: '}' });
            continue;
        }

        const ifMatch = text.match(/^if\s+(.+):\s*$/);
        if (ifMatch) {
            emitLine(`if (__py.truthy(${transformPyExpressionRaw(ifMatch[1])})) {`);
            indentStack.push({ indent, kind: 'block', closing: '}' });
            continue;
        }

        const whileMatch = text.match(/^while\s+(.+):\s*$/);
        if (whileMatch) {
            emitLine(`while (__py.truthy(${transformPyExpressionRaw(whileMatch[1])})) {`);
            indentStack.push({ indent, kind: 'block', closing: '}' });
            continue;
        }

        const forMatch = text.match(/^for\s+(.+?)\s+in\s+(.+):\s*$/);
        if (forMatch) {
            const rawTarget = forMatch[1].trim();
            const iterJs = transformPyExpressionRaw(forMatch[2]);
            if (rawTarget.includes(',')) {
                const vars = rawTarget.split(',').map(v => v.trim());
                emitLine(`for (const [${vars.join(', ')}] of __py.iter(${iterJs})) {`);
            } else {
                emitLine(`for (const ${rawTarget} of __py.iter(${iterJs})) {`);
            }
            indentStack.push({ indent, kind: 'block', closing: '}' });
            continue;
        }

        if (/^try\s*:\s*$/.test(text)) {
            emitLine(`try {`);
            indentStack.push({ indent, kind: 'block', closing: '}' });
            continue;
        }

        const exceptMatch = text.match(/^except(?:\s+[^:]+?)?(?:\s+as\s+([A-Za-z_]\w*))?\s*:\s*$/);
        if (exceptMatch) {
            const errVar = exceptMatch[1];
            emitLine(errVar ? `} catch (_py_err) { const ${errVar} = _py_err;` : `} catch (_py_err) {`);
            indentStack.push({ indent, kind: 'block', closing: '}' });
            continue;
        }

        if (/^finally\s*:\s*$/.test(text)) {
            emitLine(`} finally {`);
            indentStack.push({ indent, kind: 'block', closing: '}' });
            continue;
        }

        const withMatch = text.match(/^with\s+(.+?)(?:\s+as\s+([A-Za-z_]\w*))?\s*:\s*$/);
        if (withMatch) {
            const varName = withMatch[2] || '_py_with_res';
            emitLine(`{ const ${varName} = ${transformPyExpressionRaw(withMatch[1])};`);
            indentStack.push({ indent, kind: 'block', closing: '}' });
            continue;
        }

        // 2. Single-line block header e.g. `if x: return y`
        const inlineBlockMatch = text.match(/^(if\s+.+|else|elif\s+.+|for\s+.+|while\s+.+):\s+(.+)$/);
        if (inlineBlockMatch) {
            const hdr = inlineBlockMatch[1].trim();
            const bodyStmt = inlineBlockMatch[2].trim();
            if (hdr.startsWith('if ')) {
                emitLine(`if (__py.truthy(${transformPyExpressionRaw(hdr.slice(3))})) { ${transformSingleStatement(bodyStmt, declareLocal)} }`);
                continue;
            }
            if (hdr === 'else') {
                emitLine(`} else { ${transformSingleStatement(bodyStmt, declareLocal)} }`);
                continue;
            }
        }

        // 3. Normal single-line statement
        emitLine(transformSingleStatement(text, declareLocal));
    }

    while (indentStack.length > 0) {
        closeTopBlock();
    }

    const finalCode = scopeStack[0].lines.join('\n');
    return restorePlaceholders(finalCode, tokens);
}

function transformSingleStatement(stmt: string, declareLocal: (name: string) => void): string {
    const s = stmt.trim();
    if (!s || s === 'pass' || s === '...') return '/* pass */';
    if (s === 'break' || s === 'continue') return `${s};`;
    if (s.startsWith('global ') || s.startsWith('nonlocal ')) return `/* ${s} */`;

    // `import mod [as alias], ...`
    const importMatch = s.match(/^import\s+(.+)$/);
    if (importMatch) {
        const items = splitTopLevelCommas(importMatch[1]);
        return items.map(item => {
            const m = item.match(/^([A-Za-z_][\w.]*)(?:\s+as\s+([A-Za-z_]\w*))?$/);
            if (!m) return '';
            const modPath = m[1];
            const topName = modPath.split('.')[0];
            const alias = m[2] || topName;
            return `const ${alias} = __py.requireModule(${JSON.stringify(modPath)});`;
        }).filter(Boolean).join(' ');
    }

    // `from mod import a [as b], ...`
    const fromImportMatch = s.match(/^from\s+([A-Za-z_][\w.]*)\s+import\s+(.+)$/);
    if (fromImportMatch) {
        const modName = fromImportMatch[1];
        const items = splitTopLevelCommas(fromImportMatch[2]);
        const temp = `__py_mod_${modName.replace(/\W+/g, '_')}`;
        const assigns = items.map(item => {
            const m = item.match(/^([A-Za-z_]\w*)(?:\s+as\s+([A-Za-z_]\w*))?$/);
            if (!m) return '';
            const sym = m[1];
            const alias = m[2] || sym;
            return `const ${alias} = ${temp}['${sym}'];`;
        }).filter(Boolean).join(' ');
        return `{ const ${temp} = __py.requireModule(${JSON.stringify(modName)}); ${assigns} }`;
    }

    if (s === 'return') return 'return;';
    if (s.startsWith('return ')) {
        return `return ${transformPyExpressionRaw(s.slice(7))};`;
    }
    if (s.startsWith('raise ')) {
        const expr = transformPyExpressionRaw(s.slice(6));
        return `throw ((${expr}) instanceof Error ? (${expr}) : new Error(String((${expr}) ?? 'PythonError')));`;
    }
    if (s.startsWith('assert ')) {
        const rest = s.slice(7);
        const parts = splitTopLevelCommas(rest);
        const condJs = transformPyExpressionRaw(parts[0] || 'false');
        const msgJs = parts[1] ? transformPyExpressionRaw(parts.slice(1).join(', ')) : '"AssertionError"';
        return `if (!__py.truthy(${condJs})) { throw new Error(String(${msgJs})); }`;
    }

    // Augmented assignment (+=, -=, *=, /=)
    const augMatch = s.match(/^([A-Za-z_]\w*(?:\.[A-Za-z_]\w*|\[[^\]]+\])*)\s*(\+=|-=|\*=|\/=|%=)\s*(.+)$/);
    if (augMatch) {
        return `${augMatch[1]} ${augMatch[2]} ${transformPyExpressionRaw(augMatch[3])};`;
    }

    // Simple or tuple assignment outside equality operators (==, !=, <=, >=)
    const assignEqIdx = findAssignmentEquals(s);
    if (assignEqIdx !== -1) {
        const lhs = s.slice(0, assignEqIdx).trim();
        const rhs = s.slice(assignEqIdx + 1).trim();
        const rhsJs = transformPyExpressionRaw(rhs);

        if (lhs.includes(',')) {
            const targets = lhs.split(',').map(t => t.trim()).filter(Boolean);
            for (const t of targets) {
                if (/^[A-Za-z_]\w*$/.test(t)) declareLocal(t);
            }
            return `[${targets.join(', ')}] = __py.unpack(${rhsJs}, ${targets.length});`;
        }
        if (/^[A-Za-z_]\w*$/.test(lhs)) {
            declareLocal(lhs);
        }
        return `${lhs} = ${rhsJs};`;
    }

    return `${transformPyExpressionRaw(s)};`;
}

function findAssignmentEquals(stmt: string): number {
    let depth = 0;
    for (let i = 0; i < stmt.length; i++) {
        const ch = stmt[i];
        if (ch === '(' || ch === '[' || ch === '{') depth++;
        else if (ch === ')' || ch === ']' || ch === '}') depth = Math.max(0, depth - 1);
        else if (ch === '=' && depth === 0) {
            const prev = stmt[i - 1] || '';
            const next = stmt[i + 1] || '';
            if (prev !== '=' && prev !== '!' && prev !== '<' && prev !== '>' && prev !== '+' && prev !== '-' && prev !== '*' && prev !== '/' && prev !== '%' && next !== '=') {
                return i;
            }
            if (next === '=') i++;
        }
    }
    return -1;
}

/**
 * Self-contained browser-safe Python standard builtins & modules runtime (`__py`) injected
 * into the sandboxed iframe. Synchronous SHA-256/MD5/HMAC included for offline use.
 */
export function getPythonRuntimeBootstrapScript(): string {
    return `
    const __py = (() => {
      const truthy = (v) => {
        if (v === null || v === undefined || v === false || v === 0 || v === '') return false;
        if (Array.isArray(v)) return v.length > 0;
        if (v instanceof Set || v instanceof Map) return v.size > 0;
        if (typeof v === 'object') return Object.keys(v).length > 0;
        return Boolean(v);
      };
      const iter = (v) => {
        if (v === null || v === undefined) return [];
        if (Array.isArray(v)) return v;
        if (typeof v === 'string') return Array.from(v);
        if (v instanceof Set || v instanceof Map) return Array.from(v);
        if (typeof v === 'object') return Object.keys(v);
        return [];
      };
      const contains = (container, item) => {
        if (container === null || container === undefined) return false;
        if (typeof container === 'string') return container.includes(String(item));
        if (Array.isArray(container)) return container.includes(item);
        if (container instanceof Set || container instanceof Map) return container.has(item);
        if (typeof container === 'object') return Object.prototype.hasOwnProperty.call(container, String(item));
        return false;
      };
      const slice = (target, start, end) => {
        if (target === null || target === undefined) return target;
        const len = target.length ?? 0;
        const s = start === null || start === undefined ? 0 : (start < 0 ? Math.max(0, len + start) : start);
        const e = end === null || end === undefined ? len : (end < 0 ? Math.max(0, len + end) : end);
        return typeof target.slice === 'function' ? target.slice(s, e) : target;
      };
      const unpack = (val, count) => Array.isArray(val) ? val : iter(val).slice(0, count);

      // Compact synchronous UTF-8 bytes & SHA-256 implementation for hashlib/hmac
      const toUtf8Bytes = (input) => {
        const s = String(input ?? '');
        if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(s);
        const out = [];
        for (let i = 0; i < s.length; i++) out.push(s.charCodeAt(i) & 0xff);
        return new Uint8Array(out);
      };
      const sha256Bytes = (msgInput) => {
        const msg = msgInput instanceof Uint8Array ? msgInput : toUtf8Bytes(msgInput);
        const K = new Uint32Array([
          0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
          0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
          0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
          0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
          0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
          0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
          0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
          0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2
        ]);
        const bitLen = msg.length * 8;
        const padLen = ((msg.length + 9 + 63) >> 6) << 6;
        const buf = new Uint8Array(padLen);
        buf.set(msg);
        buf[msg.length] = 0x80;
        const dv = new DataView(buf.buffer);
        dv.setUint32(padLen - 8, Math.floor(bitLen / 0x100000000), false);
        dv.setUint32(padLen - 4, bitLen >>> 0, false);
        let h0=0x6a09e667,h1=0xbb67ae85,h2=0x3c6ef372,h3=0xa54ff53a,h4=0x510e527f,h5=0x9b05688c,h6=0x1f83d9ab,h7=0x5be0cd19;
        const W = new Uint32Array(64);
        const rotr = (x, n) => (x >>> n) | (x << (32 - n));
        for (let i = 0; i < padLen; i += 64) {
          for (let t = 0; t < 16; t++) W[t] = dv.getUint32(i + t * 4, false);
          for (let t = 16; t < 64; t++) {
            const s0 = rotr(W[t-15],7) ^ rotr(W[t-15],18) ^ (W[t-15] >>> 3);
            const s1 = rotr(W[t-2],17) ^ rotr(W[t-2],19) ^ (W[t-2] >>> 10);
            W[t] = (W[t-16] + s0 + W[t-7] + s1) >>> 0;
          }
          let a=h0,b=h1,c=h2,d=h3,e=h4,f=h5,g=h6,h=h7;
          for (let t = 0; t < 64; t++) {
            const S1 = rotr(e,6) ^ rotr(e,11) ^ rotr(e,25);
            const ch = (e & f) ^ ((~e) & g);
            const t1 = (h + S1 + ch + K[t] + W[t]) >>> 0;
            const S0 = rotr(a,2) ^ rotr(a,13) ^ rotr(a,22);
            const maj = (a & b) ^ (a & c) ^ (b & c);
            const t2 = (S0 + maj) >>> 0;
            h=g; g=f; f=e; e=(d+t1)>>>0; d=c; c=b; b=a; a=(t1+t2)>>>0;
          }
          h0=(h0+a)>>>0;h1=(h1+b)>>>0;h2=(h2+c)>>>0;h3=(h3+d)>>>0;h4=(h4+e)>>>0;h5=(h5+f)>>>0;h6=(h6+g)>>>0;h7=(h7+h)>>>0;
        }
        const out = new Uint8Array(32);
        const odv = new DataView(out.buffer);
        [h0,h1,h2,h3,h4,h5,h6,h7].forEach((val, idx) => odv.setUint32(idx * 4, val, false));
        return out;
      };
      const toHex = (bytes) => Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');

      const makeHashObj = (data) => {
        const bytes = sha256Bytes(data ?? '');
        return { digest: () => bytes, hexdigest: () => toHex(bytes) };
      };

      const modules = {
        json: {
          loads: (s) => JSON.parse(String(s)),
          dumps: (o, indent) => JSON.stringify(o, null, indent || undefined)
        },
        math: Math,
        time: {
          time: () => Date.now() / 1000,
          monotonic: () => (typeof performance !== 'undefined' ? performance.now() / 1000 : Date.now() / 1000),
          sleep: (sec) => new Promise(r => setTimeout(r, Math.max(0, Number(sec || 0) * 1000)))
        },
        datetime: {
          datetime: {
            now: () => new Date(),
            utcnow: () => new Date()
          },
          timedelta: (opts) => (opts && opts.seconds ? opts.seconds * 1000 : 0)
        },
        re: {
          search: (p, s) => new RegExp(p).exec(String(s)),
          match: (p, s) => new RegExp('^' + p).exec(String(s)),
          findall: (p, s) => Array.from(String(s).matchAll(new RegExp(p, 'g'))).map(m => m[1] !== undefined ? m[1] : m[0]),
          sub: (p, repl, s) => String(s).replace(new RegExp(p, 'g'), repl),
          split: (p, s) => String(s).split(new RegExp(p)),
          compile: (p) => new RegExp(p, 'g')
        },
        base64: {
          b64encode: (s) => btoa(unescape(encodeURIComponent(String(s ?? '')))),
          b64decode: (s) => decodeURIComponent(escape(atob(String(s ?? '')))),
          urlsafe_b64encode: (s) => btoa(unescape(encodeURIComponent(String(s ?? '')))).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, ''),
          urlsafe_b64decode: (s) => {
            const norm = String(s ?? '').replace(/-/g, '+').replace(/_/g, '/');
            return decodeURIComponent(escape(atob(norm)));
          }
        },
        hashlib: {
          sha256: makeHashObj,
          sha512: makeHashObj,
          sha1: makeHashObj,
          md5: makeHashObj
        },
        hmac: {
          new: (key, msg) => {
            let k = key instanceof Uint8Array ? key : toUtf8Bytes(key);
            if (k.length > 64) k = sha256Bytes(k);
            const blockKey = new Uint8Array(64);
            blockKey.set(k);
            const oPad = new Uint8Array(64);
            const iPad = new Uint8Array(64);
            for (let i = 0; i < 64; i++) {
              oPad[i] = blockKey[i] ^ 0x5c;
              iPad[i] = blockKey[i] ^ 0x36;
            }
            const mBytes = msg instanceof Uint8Array ? msg : toUtf8Bytes(msg);
            const inner = new Uint8Array(64 + mBytes.length);
            inner.set(iPad);
            inner.set(mBytes, 64);
            const innerHash = sha256Bytes(inner);
            const outer = new Uint8Array(64 + 32);
            outer.set(oPad);
            outer.set(innerHash, 64);
            const mac = sha256Bytes(outer);
            return { digest: () => mac, hexdigest: () => toHex(mac) };
          }
        },
        uuid: {
          uuid4: () => (typeof crypto !== 'undefined' && crypto.randomUUID)
            ? crypto.randomUUID()
            : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
                const r = (Math.random() * 16) | 0;
                return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
              })
        },
        random: {
          random: () => Math.random(),
          randint: (a, b) => Math.floor(Math.random() * (b - a + 1)) + a,
          uniform: (a, b) => a + Math.random() * (b - a),
          choice: (arr) => arr[Math.floor(Math.random() * arr.length)]
        },
        urllib: {
          parse: {
            quote: (s) => encodeURIComponent(String(s ?? '')),
            unquote: (s) => decodeURIComponent(String(s ?? '')),
            urlencode: (obj) => new URLSearchParams(obj || {}).toString(),
            urlparse: (u) => new URL(String(u))
          }
        },
        requests: {
          request: async (method, url, opts) => {
            const init = {
              method: String(method || 'GET').toUpperCase(),
              headers: (opts && opts.headers) || {}
            };
            if (opts && opts.json !== undefined) {
              init.headers = Object.assign({ 'Content-Type': 'application/json' }, init.headers);
              init.body = JSON.stringify(opts.json);
            } else if (opts && opts.data !== undefined) {
              init.body = typeof opts.data === 'string' ? opts.data : new URLSearchParams(opts.data).toString();
            }
            const res = await _proxyFetch(url, init);
            return {
              status_code: res.code,
              ok: res.code >= 200 && res.code < 300,
              text: res.body,
              headers: res.headers,
              json: () => res.json()
            };
          },
          get: (url, opts) => modules.requests.request('GET', url, opts),
          post: (url, opts) => modules.requests.request('POST', url, opts),
          put: (url, opts) => modules.requests.request('PUT', url, opts),
          delete: (url, opts) => modules.requests.request('DELETE', url, opts),
          patch: (url, opts) => modules.requests.request('PATCH', url, opts)
        }
      };

      const requireModule = (modPath) => {
        const parts = String(modPath || '').split('.');
        let cur = modules[parts[0]];
        for (let i = 1; i < parts.length && cur; i++) cur = cur[parts[i]];
        if (!cur) throw new Error('Python module "' + modPath + '" is not available in this sandbox.');
        return cur;
      };

      const get = (target, ...args) => {
        if (target && typeof target.get === 'function') return target.get(...args);
        if (target && typeof target === 'object') {
          const k = args[0];
          return (Object.prototype.hasOwnProperty.call(target, k) && target[k] !== undefined)
            ? target[k]
            : (args.length > 1 ? args[1] : null);
        }
        return args.length > 1 ? args[1] : null;
      };
      const items = (target) => (target && typeof target.items === 'function')
        ? target.items()
        : (target && typeof target === 'object' ? Object.entries(target) : []);
      const keys = (target) => (target && typeof target.keys === 'function')
        ? target.keys()
        : (target && typeof target === 'object' ? Object.keys(target) : []);
      const values = (target) => (target && typeof target.values === 'function')
        ? target.values()
        : (target && typeof target === 'object' ? Object.values(target) : []);
      const update = (target, other) => {
        if (target && typeof target.update === 'function') return target.update(other);
        if (target && typeof target === 'object' && other && typeof other === 'object') Object.assign(target, other);
        return target;
      };
      const pop = (target, ...args) => {
        if (target && typeof target.pop === 'function') return target.pop(...args);
        if (target && typeof target === 'object') {
          const k = args[0];
          if (Object.prototype.hasOwnProperty.call(target, k)) {
            const v = target[k];
            delete target[k];
            return v;
          }
          return args.length > 1 ? args[1] : null;
        }
        return null;
      };
      const setdefault = (target, k, defVal = null) => {
        if (target && typeof target === 'object') {
          if (!Object.prototype.hasOwnProperty.call(target, k)) target[k] = defVal;
          return target[k];
        }
        return defVal;
      };
      const append = (target, item) => { if (Array.isArray(target)) target.push(item); else if (target && typeof target.append === 'function') target.append(item); };
      const extend = (target, seq) => { if (Array.isArray(target)) target.push(...iter(seq)); else if (target && typeof target.extend === 'function') target.extend(seq); };
      const strip = (target, chars) => (target && typeof target.strip === 'function') ? target.strip(chars) : String(target ?? '').trim();
      const lstrip = (target) => (target && typeof target.lstrip === 'function') ? target.lstrip() : String(target ?? '').trimStart();
      const rstrip = (target) => (target && typeof target.rstrip === 'function') ? target.rstrip() : String(target ?? '').trimEnd();
      const upper = (target) => (target && typeof target.upper === 'function') ? target.upper() : String(target ?? '').toUpperCase();
      const lower = (target) => (target && typeof target.lower === 'function') ? target.lower() : String(target ?? '').toLowerCase();
      const startswith = (target, prefix) => (target && typeof target.startswith === 'function') ? target.startswith(prefix) : String(target ?? '').startsWith(prefix);
      const endswith = (target, suffix) => (target && typeof target.endswith === 'function') ? target.endswith(suffix) : String(target ?? '').endsWith(suffix);
      const join = (target, seq) => (typeof target === 'string') ? iter(seq).join(target) : (target && typeof target.join === 'function' ? target.join(seq) : '');

      const installProtoShims = () => {};
      const removeProtoShims = () => {};

      const builtins = {
        print: (...args) => console.log(...args),
        len: (v) => v == null ? 0 : (Array.isArray(v) || typeof v === 'string' ? v.length : (v.size !== undefined ? v.size : Object.keys(v).length)),
        str: (v) => v === null ? 'None' : (typeof v === 'object' ? JSON.stringify(v) : String(v)),
        int: (v, base) => base ? parseInt(String(v), base) : parseInt(String(v), 10),
        float: (v) => parseFloat(String(v)),
        bool: (v) => truthy(v),
        list: (v) => v === undefined ? [] : Array.from(iter(v)),
        dict: (v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.assign({}, v) : Object.fromEntries(iter(v)),
        set: (v) => new Set(v === undefined ? [] : iter(v)),
        tuple: (v) => v === undefined ? [] : Array.from(iter(v)),
        range: (a, b, step) => {
          const start = b === undefined ? 0 : a;
          const stop = b === undefined ? a : b;
          const st = step === undefined ? 1 : step;
          const out = [];
          if (st > 0) { for (let i = start; i < stop; i += st) out.push(i); }
          else if (st < 0) { for (let i = start; i > stop; i += st) out.push(i); }
          return out;
        },
        enumerate: (seq, start = 0) => iter(seq).map((item, idx) => [start + idx, item]),
        zip: (...seqs) => {
          const arrays = seqs.map(iter);
          const minLen = arrays.length ? Math.min(...arrays.map(a => a.length)) : 0;
          const out = [];
          for (let i = 0; i < minLen; i++) out.push(arrays.map(a => a[i]));
          return out;
        },
        isinstance: (v, t) => {
          if (t === builtins.dict || t === Object) return v !== null && typeof v === 'object' && !Array.isArray(v);
          if (t === builtins.list || t === Array) return Array.isArray(v);
          if (t === builtins.str || t === String) return typeof v === 'string';
          if (t === builtins.int || t === builtins.float || t === Number) return typeof v === 'number';
          if (t === builtins.bool || t === Boolean) return typeof v === 'boolean';
          if (Array.isArray(t)) return t.some(sub => builtins.isinstance(v, sub));
          return typeof v === 'object' && v instanceof t;
        },
        abs: Math.abs,
        min: (...args) => Math.min(...(args.length === 1 && Array.isArray(args[0]) ? args[0] : args)),
        max: (...args) => Math.max(...(args.length === 1 && Array.isArray(args[0]) ? args[0] : args)),
        sum: (seq, init = 0) => iter(seq).reduce((acc, x) => acc + Number(x), init),
        round: (n, d = 0) => { const f = Math.pow(10, d); return Math.round(Number(n) * f) / f; },
        sorted: (seq, reverse = false) => {
          const arr = Array.from(iter(seq)).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
          return reverse ? arr.reverse() : arr;
        },
        reversed: (seq) => Array.from(iter(seq)).reverse(),
        any: (seq) => iter(seq).some(truthy),
        all: (seq) => iter(seq).every(truthy),
        chr: (c) => String.fromCharCode(c),
        ord: (s) => String(s).charCodeAt(0)
      };

      return {
        truthy, iter, contains, slice, unpack,
        get, items, keys, values, update, pop, setdefault,
        append, extend, strip, lstrip, rstrip, upper, lower, startswith, endswith, join,
        modules, requireModule, installProtoShims, removeProtoShims, builtins
      };
    })();
    `;
}
