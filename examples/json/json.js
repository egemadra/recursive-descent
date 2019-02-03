"use strict";

const {BNFParser, Parser} = require(__dirname + "/../../index.js");
const fs = require("fs");
const crawl = require("tree-crawl");

//Load our grammar, feed it to the BNF Parser.
const grammar = fs.readFileSync("./json.grammar", "utf8");
const bnfParser = new BNFParser(grammar);
const rules = bnfParser.parse();

const program = `
[
  -4.34e-3,
  "hello 💩",
  false,
  true,
  null,
  {
    "my-key": {},
    "otherKey": []
  }
]`;
//Ask parser to not to give us tokens that don't represent a value
//This results in much cleaner and smaller tree.
const options = {
  exclude: ["{", "}", "[", "]", ",", ':']
};
//Parse the program
const parser = new Parser(rules, program, options);
const root = parser.parse();

//Print a nice parse tree.
//Note that excluded tokens don't show up.
//Also note that subrules in object_body and array_body
//are nicely flattened into their parent rule and don't
//appear as subrules, thanks to the '<' operator.
parser.print(root);

//Rebuild the actual json as javascript from the parsed tree:
const tokenStack = [];
let json; //our result

crawl(root, (node, context) => {
  //all terminal nodes are lexerNodes because we defined them with '='
  //instead of ':' and requested our parser to not return '{}[],:'.
  //#eof is also eliminated as we don't process and put it into our stack.
  if (node.isLexerRule) {
    let value = node.value;
    switch(node.name) {
      //strip quotation marks for strings, convert other terminals to js equivalents
      case 'string': value = value.substr(1, value.length - 2); break;
      case 'number': value = +value; break;
      case 'true': value = true; break;
      case 'false': value = false; break;
      case 'null': value = null; break;
    }
    tokenStack.push(value);
    return;
  }

  //Non-terminals. We only catch a few interesting ones as
  //others are easily accesible from their tokens.
  switch(node.name) {

    case 'object': {
      const object = {}; //create js object;
      if (node.tokens.length) { //has an object_body in node.tokens[0]
        const pairCount = node.tokens[0].tokens.length;
        //each pair has a key and value, so pop tokens from stack in pairs:
        const keyValuePairs = tokenStack.splice(tokenStack.length - pairCount * 2);
        while (keyValuePairs.length)
          object[keyValuePairs.shift()] = keyValuePairs.shift();
      }
      tokenStack.push(object);
      break;
    }

    case 'array': {
      const arr = []; //create js array
      if (node.tokens.length)  //has an array_body in node.tokens[0]
        for (let i = 0; i < node.tokens[0].tokens.length; i++)
          arr.unshift(tokenStack.pop());
      tokenStack.push(arr);
      break;
    }

    case 'program': json = tokenStack.pop(); break;
  }

   //depth-first post-order traversal so that parent nodes
   //have access to processed children in the token stack.
}, {getChildren: node => node.tokens, order: "post"});

//make sure we properly processed everything:
if (tokenStack.length) throw new Error("Forgot to pop something from the token stack.");

console.dir(json, {depth: null});