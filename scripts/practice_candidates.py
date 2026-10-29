"""Dependency-free source candidates, not a compiler or a visual QA pass."""
import ast
import fnmatch
import io
import pathlib
import re
import tokenize


def lexical(text):
    """Mask strings/comments while retaining character positions and line numbers."""
    pattern=re.compile(r'//[^\n]*|/\*[\s\S]*?\*/|"(?:\\.|[^"\\])*"|\x27(?:\\.|[^\x27\\])*\x27|`(?:\\.|[^`\\])*`')
    comments=[]
    def mask(match):
        value=match.group()
        if value.startswith(('//','/*')): comments.append((text.count('\n',0,match.start())+1,value))
        return ''.join('\n' if c=='\n' else ' ' for c in value)
    return pattern.sub(mask,text),comments


def smell_candidates(name,text,config,warnings=None):
    suffix=pathlib.Path(name).suffix
    if suffix not in {'.ts','.tsx','.js','.jsx','.mjs','.cjs','.py','.swift'}:return []
    limits=config.get('smell_thresholds',{});fn_limit=limits.get('function_lines',60);depth_limit=limits.get('nesting_depth',4)
    if not isinstance(fn_limit,int) or not isinstance(depth_limit,int) or min(fn_limit,depth_limit)<1:raise ValueError('Invalid smell thresholds')
    found=[];comments=[]
    def add(id,line,message):found.append((id,line,message))
    if suffix=='.py':
        try:
            for token in tokenize.generate_tokens(io.StringIO(text).readline):
                if token.type==tokenize.COMMENT:comments.append((token.start[0],token.string))
            tree=ast.parse(text)
        except (SyntaxError,tokenize.TokenError):
            if warnings is not None: warnings.append({'file':name,'check':'ENG-CAND-*','reason':'Python syntax could not be analyzed by the host parser; unverified'})
            return []
        for node in ast.walk(tree):
            if isinstance(node,(ast.FunctionDef,ast.AsyncFunctionDef)) and node.end_lineno-node.lineno+1>fn_limit:add('ENG-CAND-001',node.lineno,'Function exceeds configured line threshold')
            if isinstance(node,ast.ExceptHandler) and all(isinstance(x,ast.Pass) or isinstance(x,ast.Expr) and isinstance(x.value,ast.Constant) and x.value.value is Ellipsis for x in node.body):add('ENG-CAND-003',node.lineno,'Except block has no observable handling')
        def visit(node,depth):
            branch=isinstance(node,(ast.If,ast.For,ast.AsyncFor,ast.While,ast.Try,ast.With,ast.AsyncWith)+((ast.Match,) if hasattr(ast,'Match') else ()))
            depth=depth+1 if branch else depth
            if branch and depth==depth_limit+1:add('ENG-CAND-002',node.lineno,'Control nesting exceeds configured threshold')
            for child in ast.iter_child_nodes(node):visit(child,0 if isinstance(child,(ast.FunctionDef,ast.AsyncFunctionDef)) else depth)
        visit(tree,0)
    else:
        masked,comments=lexical(text)
        starts=re.compile(r'\b(?:function\s*\w*|func\s+\w+)\s*\([^)]*\)[^{]*\{|\b(?:const|let|var)\s+\w+\s*=\s*[^;\n]*=>\s*\{')
        method=re.compile(r'(?m)^\s*(?:(?:public|private|protected|static|async|override|mutating)\s+)*(?P<name>[A-Za-z_$]\w*)\s*\([^;\n{}]*\)\s*(?::[^;{\n]+)?\s*\{')
        matches=list(starts.finditer(masked))+[m for m in method.finditer(masked) if m['name'] not in {'if','for','while','switch','catch','with'}]
        for match in matches:
            opening=match.end()-1;depth=1;end=opening+1
            while end<len(masked) and depth:
                depth+= (masked[end]=='{')-(masked[end]=='}');end+=1
            line=masked.count('\n',0,match.start())+1
            if depth==0 and masked.count('\n',opening,end)+1>fn_limit:add('ENG-CAND-001',line,'Function exceeds configured line threshold')
        depth=0
        for match in re.finditer(r'[{}]',masked):
            depth+=1 if match.group()=='{' else -1
            if depth==depth_limit+2 and match.group()=='{':add('ENG-CAND-002',masked.count('\n',0,match.start())+1,'Brace nesting exceeds configured threshold; inspect control context')
        for match in re.finditer(r'\bcatch\s*(?:\([^)]*\)|[^{\n]*)?\s*\{\s*\}',masked):add('ENG-CAND-003',masked.count('\n',0,match.start())+1,'Catch block has no observable handling')
    comments=[(line+offset,part) for line,block in comments for offset,part in enumerate(block.splitlines())]
    previous=None
    for line,comment in comments:
        stripped=re.sub(r'^\s*(?://|/\*|\*|#)\s*','',comment).strip()
        if re.search(r'\b(TODO|FIXME)\b',stripped) and len(re.findall(r'\w+',stripped))<5 and not re.search(r'#\d+|https?://|[A-Z]+-\d+',stripped):add('ENG-CAND-005',line,'TODO/FIXME lacks explanation or issue reference')
        code=bool(re.search(r'\b(const|let|var|return|def|func|function)\b|\w+\s*=|\w+\(',stripped))
        if code and previous is not None and previous==line-1:add('ENG-CAND-004',line-1,'Consecutive comments resemble source code')
        previous=line if code else None
    return found


DESIGN_PROP=re.compile(r'\b(fontSize|font-size|margin(?:Top|Bottom|Left|Right)?|margin-(?:top|bottom|left|right)|padding(?:Top|Bottom|Left|Right)?|padding-(?:top|bottom|left|right)|gap|borderRadius|border-radius|boxShadow|box-shadow|zIndex|z-index)\s*:\s*["\x27]?(-?\d+(?:\.\d+)?(?:px|rem|em|vh|vw)?(?:[^;"\x27,}\n]*))')


def design_candidates(name,text,config,token_globs):
    suffix=pathlib.Path(name).suffix
    if suffix not in {'.tsx','.jsx','.html','.vue','.svelte','.css','.scss'}:return []
    found=[];is_token=any(fnmatch.fnmatch(name,g) for g in token_globs)
    def add(id,offset,message):found.append((id,text.count('\n',0,offset)+1,message))
    if not is_token:
        for match in DESIGN_PROP.finditer(text):
            values=config.get('design_scales',{}).get(match[1],[])
            if match[2].strip() not in [str(v) for v in values]:add('UI-002',match.start(),'Raw type/space/radius/shadow/layer value outside token files/scales')
        for match in re.finditer(r'\bstyle\s*=\s*(?:\{\{|["\x27])',text):add('UI-002',match.start(),'Inline style carries component design values; inspect dynamic exceptions')
    if is_token:
        definitions=list(re.finditer(r'--([\w-]+)\s*:',text))
        dark=text.lower().find('dark')
        before={m[1]:m.start() for m in definitions if dark<0 or m.start()<dark}
        after={m[1] for m in definitions if dark>=0 and m.start()>=dark}
        for token,offset in before.items():
            if token not in after:add('UI-DS-002',offset,'Light token lacks a dark override; verify intentional invariant inheritance')
    interact=list(re.finditer(r'<(?:button|input|select|textarea|a\b[^>]*href)\b[^>]*>',text,re.I))
    for match in interact:
        if not re.search(r':focus|focus-visible|focus:',text):add('UI-DS-003',match.start(),'Interactive element has no local focus treatment; inspect shared/UA styles')
        if re.search(r'(?:width|height|minWidth|minHeight)\s*[:=]\s*["\x27]?(?:[0-9]|[1-3][0-9]|4[0-3])(?:px)?\b',match.group()):add('UI-DS-003',match.start(),'Declared touch dimension is below 44px; verify computed box')
    for match in re.finditer(r'\b(?:width|height|min-height|min-width)\s*:\s*(\d+(?:\.\d+)?)px\b',text):
        if float(match[1])<44:add('UI-DS-003',match.start(),'Declared dimension is below 44px; verify it belongs to a touch target')
    for match in re.finditer(r':focus(?:-visible)?[^{}]*\{([^}]+)\}',text):
        if re.search(r'outline\s*:\s*(?:none|0)',match[1]) and not re.search(r'box-shadow|border(?:-color)?\s*:',match[1]):add('UI-DS-003',match.start(),'Focus outline removed without a local replacement')
    for match in re.finditer(r'<img\b[^>]*>',text,re.I):
        tag=match.group()
        if not re.search(r'\balt\s*=',tag):add('UI-DS-004',match.start(),'Image lacks alt attribute')
        if not (re.search(r'\bwidth\s*=',tag) and re.search(r'\bheight\s*=',tag)) and not re.search(r'aspect-?ratio',tag,re.I):add('UI-DS-004',match.start(),'Image lacks intrinsic dimensions or local aspect ratio; inspect shared CSS')
    for match in re.finditer(r'object(?:-fit|Fit)\s*:\s*["\x27]?fill\b',text):add('UI-DS-004',match.start(),'object-fit fill may distort image geometry')
    return found
