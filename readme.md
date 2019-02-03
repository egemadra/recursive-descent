
# Recursive descent
This is a recursive-descent parser building utility tool written in javascript and inspired by ANTLR. You input a grammar definition and a program conforming to that grammar, the generator will output a syntax tree and a few tools to manipulate and walk that tree.

## Features
- LL(1) parser, with 1 token lookahead.
- Backtracking to parse ambiguous grammars.
- Strict LL(1) checking which finds and throws errors at left-recursion, common prefix, used but undefined rules, ambiguous token capturing caused by *?+ operators and rules that potentially producing no tokens.
- Warns about defined but unused (unreachable) rules.
- Rudimentary tree walker.
- Optional trimming of tree branches by removing nodes that have a single non-terminal.
- Optional removal of non-semantic tokens.
- Optional Subrule flattening.
- Lexer customization via callbacks.

## Installation
The program can run on node.js. No special build for browsers exists, but it should run on browsers with the help of a module bundler.

Node: `npm install recursive-descent`

If you cloned the GIT repository, you will need to install npm dependencies.

## Usage

### Quick example

Note that `String.raw` is used to avoid escaping backslashes in regexps. This simulates reading the grammar from a file.
```javascript
const  grammar  =  String.raw`
	//this is a comment

	//special ignore token to allow and ignore whitespace
	ignore = ~[\s]+~ ;
	number = ~[0-9]+(\.[0-9]+)?~ ;

	//special program rule to mark the root node
	program : expression ;

	//< operator flattens subrules
	expression : term <('+' term | '-' term)* ;
	term : factor <('*' factor | '/' factor)* ;
	factor : '-'? atom ;
	atom
		: number
		| '(' expression ')'
		;
`;
const recdec = require("recursive-descent");
const rules  = recdec.bnfParse(grammar);

const rootNode = recdec.parse(rules, "3 + 4 * 5");
recdec.print(rootNode);
```
Produces:
```
program
├─┬ expression
│ ├─┬ term
│ │ └─┬ factor
│ │   └─┬ atom
│ │     └── number: 3
│ ├── string: +
│ └─┬ term
│   ├─┬ factor
│   │ └─┬ atom
│   │   └── number: 4
│   ├── string: *
│   └─┬ factor
│     └─┬ atom
│       └── number: 5
└── #eof:
```

## Grammar definition

Grammar definition syntax is based on a variation of an EBNF (Extended Bachus Naur Form).

A grammar file is a list of rule definitions. Each rule must end with a semicolon. Whitespace is unimportant. There exists a single line comment, which starts with '//' and ends with a new line.

There are 2 types of rules: Lexer rules and parser rules. Lexer rules are used for matching tokens from an input program, rule name and rule body are separated with a '=' sign whereas parser rules use ':'. Lexer rules are not required and tokens can be marked by their literal expressions anywhere in the grammar code. Lexer rules, however, are convenient as it allows matching a token with a name.

All rules may have alternatives, which are separated by '|' sign. Expressions within an alternative can also be grouped with parentheses, which are converted to anonymous rules behind the scenes. Example:

```Grammar
variableDeclaration
	: 'var' identifier
	| 'let' identifier
;
```
This could also be written as
```Grammar
variableDeclaration : ('var' | 'let') identifier ;
```

Lexer rules can contain only one expression per alternative and this expression can represent a string, a regexp or a user defined function from which a token is produced.

- String: A string expression is single quote delimited. Like 'if'.
`if = 'if'`

- Regexp: A regexp expression is delimited by '~' symbol. Right after the closing ~, you can put an 'i' to match tokens case insensitively. Such as `~[a-z]+~i` Don't put ^, $ or any other anchors. ^ is automatically inserted at the beginning.
`number = ~[0-9]+(\.[0-9]+)?~ ;`
`identifier = ~[A-Za-z][A-Za-z0-9_]*~ ;`

- Function: Expression consists of a '$' sign and the function name. You also need to register this name using `registerLexerMethod(parser, ruleName, callback)` call. When the parser needs a token, it calls *callback* with the rule name and the source. *callback* should return one of the followings:
	-  null or undefined:  That means the callback didn't match any tokens.
	-  string. The callback matched this string. Parser updates the stream by the length of this returned string.
	- object with **value**, and **length** fields. value is the matched string, length is how many characters the parser should consume from the current point in the input stream. This separation allows reading more characters and/or returning an arbitrary value from the source.
`someRule = $myRule ;`
Somewhere in your program:
```javascrpit
recdec.registerLexerRule(parser, "myRule", inputString => {
	//read from input string
	//if string doesn't match what we are looking for return null
	//if string matches what we are looking for return string
	//alternatively return {value: 'somestring', length: 10};
});
```
Lexer picks the longest string among matches. If more than one match are equally the longest, the one defined **earlier** in the grammar is chosen. This is important because if you have an identifier defined as, for example, \~[A-Za-z]\~, and a keyword defined as 'Class' you most likely want the tokenizer to classify 'Class' as a keyword and not an identifier. So you put the 'Class' definition before the identifier definition.
```
Class = 'Class' ;
identifier = ~[A-Za-z][A-Za-z0-9_]*~ ;
```

Parser rules use ':' to to separate the definition.

A parser rule's alternatives can contain lexer literals (string, regexp and function) and other rules. Each can have a quantifier; one of '\*', '?' or '+', just like regular expressions. Groups in parentheses are also rules, so they can also take quantifiers.

*ignore* is a special rule, as mentioned above, which ignores the tokens that it matched. They don't appear in the resulting tree. Typically, comments and white space (in grammars where white space is insignificant) are processed by these.

*program* is another special rule which marks the root of the tree. Every program must have this special rule or the parser throws.

### Special directives in grammar
This program defines a few additions to a typical EBNF:

- '**!**' sign before any expression means that expression won't appear in the resulting parse tree. This is useful to eliminate tokens which don't convey values themselves but required by the syntax. In the example below, the parentheses are not included in the parse tree, even though they are required for parser to correctly identify precedence level.
```Grammar
factor : neg? (number | !'(' group !')') ;
```
- '**<**' sign before non-terminals adds the tokens of the applied non-terminal to the parent rule (flattens the subrule). In the example below, first "term" non-terminals are applied '<'. Without it, the expression node in the resulting parse tree would have 2 tokens: term and the group. But with '<' the *term* is not added to the expression as a token, but instead, *term*'s tokens are expanded and then appended to the tokens array of the rule *expression*. This feature reduces the branch depth of a parse tree and flattens certain parts of it but obviously the tree won't represent the grammar one-to-one.

```Grammar
expression : <term ('+' term | '-' term) ;
```

- '**@**' sign **right at the beginning of an alternative** renders that alternative subject to **backtracking**. Normally, when the parser tries an alternative, as soon as an expression matches the current token the alternative is considered "found". Subsequently, when a required expression (whose quantifier is not '\*' or '?') fails to match the next token, the parser generates an error. With @ sign at the beginning of an alternative disables this for that alternative and as soon as required expression fails to match, the parser backtracks and continues from the next alternative. Backtracking is used to handle grammar ambiguities caused by what is called "the common prefix" or "first/first" and first/follow conflicts. The grammar becomes more expressive but depending on where it is used, it can cause parsing time to increase significantly, due to the recursive nature of the parser. The example below would give an error without the '@' sign, as the first non-terminal of each alternative is the same. This says that try the first alternative, and if it produces a *thenStatement* add it to the parse tree. If it fails (when it sees a '{' instead of a *statement* declaration for example) it tries the next alternative.

```Grammar
thenStatement
	: @ 'then' '{' statements '}'
	| 'then' statement
;
```
- '**=**' sign after a group allows you to rename the resulting rule. Normally groups in parentheses appear as "#anonymous-rule#1", in the parse tree, which may not be helpful. Putting an '=' then a name (before a quantifier if exists) renames it in the resulting parse tree. Note that if quantifier exists, it must come after the name.
```
expression : term ('+' term | '-' term) = subExpression * ;
```
## Walking the tree
When parser.parse() method executes successfully, it returns the root node of the tree which represents the entire program, encoded in the *program* rule.

Nodes have a simple structure.

Rule nodes have the following fields:

	- name
	- tokens
	- isLexerRule
	- value

*name* is the name of the rule as defined in the grammar, *tokens* is an array which contains child nodes (tokens or rules). For non-terminal rules (defined with ':') *isLexerRule* rule is false. For terminal rules (defined with '=') *isLexerRule* is true and *value* holds the parsed token value.

Token nodes have these fields:

	- type
	- value
	- line
	- col
	- src

*type* is one of "string", "regexp" or "function", *value* is the parsed token value. *line* and *col* displays line and column numbers of where in the source file this particular token is found. *src* is the definition in the grammar file which caused the creation of this token.

With this information, it is relatively easy to navigate within a tree.
```javascript
const rootNode = parser.parse();
console.log(rootNode.name); //program
console.log(rootNode.tokens.length); //children count
const first = rootNode.tokens[0];
if (first.isLexerRule) //lexer rule, represents a token
  console.log(first.name, first.value);
else if ("value" in first) //inline token
  console.log(first.value + " found in " + first.line + ':' + first.col);
else //non-terminal rule
  console.log(first.name + " has " + first.tokens.length + " children.");
```
More often than not, you will need to recursively walk the tree. You may use the provided  parser.walk() method, which provides an enter and exit methods that are called as the parser enters or exits the rules. Please see the api section below to get more information about .walk().

Another approach is to use a 3rd party generic tree walker after a parse is complete, such as [tree-crawl](https://www.npmjs.com/package/tree-crawl). Please see the examples folder which contain 2 annotated examples utilizing this library to parse a simple calculator as well as json.

## API

Recursive Descent exposes 2 classes: BNFParser and Parser. BNFParser class is responsible for parsing the grammar of your language. Parser class uses information from that parsed grammar and a source input to produce a syntax tree. See the contents of index.js file which conveniently wraps those classes and exposes only the public calls.

### BNFParser Class:
#### new BNFparser (grammar)
Constructor expects a string that is your grammar.

#### .parse()
Attempts to parse a grammar. If the grammar has errors, it throws. Returns an object representing the grammar that matches the string representation. You can JSON.stringify this to be used by the parser class later on.

This stage catches all left-recursion, common prefix and other errors, so that if this call is successful, it is guaranteed that the parser can parse the programs conforming to this grammar unambiguously.
```javascript
const recdec = require("recursive-descent");
const bnfParser = new recdec.BNFParser(someGrammar);
const rules = bnfParser.parse();
```
Alternatively
```javascript
const recdec = require("recursive-descent");
const rules = recdec.bnfParse(someGrammar);
```
### Parser Class:
#### new Parser (rules, program, options)
Constructor expects rules object that is obtained from BNFParser.parse(), a program which conforms to those rules and optional options object to guide the parsing.
```javascript
//we have rules obtained from BNFParser.parse();
const parser = new recdec.Parser(rules, "3+5");
const rootNode = parser.parse();
```
Alternatively:
```javascript
const rootNode = recdec.parse(rules, "3+5");
```
options is an optional object with following fields:

**trim**: (boolean, defaults to false). When `{trim: true}` is passed as options the parser remove all rules that contain a single non-terminal then attaches the removed terminals to the topmost rule which is not eliminated by this algorithm. This has the potential to hugely simplify trees whose grammar has a lot of precedence levels. Obviously the resulting tree won't match the grammar anymore.

**notrim**: (array, defaults to []). Used with trim: true. A set of rule names which are protected against the effects of trim. `{trim: true, notrim: ["someRule"]}` instructs the parser to include the rule "someRule" to the parse tree even if contains a single non-terminal.

**exclude**: (array, defaults to []). Similar to '!' operator, if a parser produces a terminal whose value is found in this array, it will be excluded from the parse tree. `{exclude: ['(', ')', '[', ']']}` will remove all 4 parentheses from the resulting tree, as if we had put '!' in front of every appearance of those characters in the grammar.

#### registerLexerMethod (ruleName, callback)
Lexer calls methods that are registered with this method every time it needs a token. If callback returns a string or an object with .value and .length fields, parser creates a token whose type is ruleName and value is what is returned by the callback. Return value is unimportant.

#### parse ()
Attempts to parse a program using the rule set and options given in the constructor. If an error is found, it throws. Returns the root node (a rule that matches the grammar rule named "program").

#### print (node)
Prints a tree representing the node structure to the console. *node* maybe the root node obtained by the .parse method, or any other child node. Return value is unimportant.
`parser.print(node)`.

#### walk (node, callbacks)
Walks through the tree starting with the *node*. *callbacks* is an object with 2 fields: *enter* and *exit*, both of which are functions. *enter* is called every time the parser starts processing a rule and *exit* is called every time it successfully parsed a rule. Each callback expects a rule argument where the parser passes the rule in question.
```javascript
const rootNode = parser.parse(rules, "3 + 5");
parser.walk(rootNode, {
	enter: rule => {
		console.log(rule.name + " is entered.")
		console.log(rule);
	},
	exit: rule => {
		console.log(rule.name + " is exited.")
		console.log(rule);
	}
});
```

## Compatibility

This is written for node.js and uses some ES6 features but recent node versions and browsers should be able to run it.

## License

MIT