"use strict";

const {BNFParser, Parser} = require(__dirname + "/../../index.js");
const fs = require("fs");
const crawl = require("tree-crawl");

//Load our grammar, feed it to the BNF Parser.
const grammar = fs.readFileSync("./calculator.grammar", "utf8");
const bnfParser = new BNFParser(grammar);
const rules = bnfParser.parse();

function calculate (expression, printTree) {
  //Trim option removes from the tree non-terminal rules
  //that contain a single non-terminal rule. This
  //greatly reduces number of branches in a tree from
  //a grammar that has a long op precedence list, but at the
  //cost of tree not representing the program accurately.
  const options = {trim: true};
  const parser = new Parser(rules, expression, options);
  const root = parser.parse();

  //Print a nice parse tree.
  //Note that outer parentheses in add and mult show as
  //anonymous-rule#1 and anonymous-rule#3.
  //Also note that subrules that contain +- and */ tokens
  //are flattened with '<' so they don't show up in the tree.
  if (printTree) parser.print(root);

  //Calculate while traversing the tree using a stack machine:
  const tokenStack = [];
  let result; //our result

  crawl(root, (node, context) => {
    //Process terminals first.

    //NUMBER is a lexer rule as we defined it with '=' instead of ':'.
    //'+,-,*,/' are inline string tokens.
    //'()' don't appear thanks to '!' operator.
    if (node.type === '#eof') return; //don't process eof token.
    if (node.isLexerRule) return tokenStack.push(+ node.value); //NUMBER
    if ("value" in node) return tokenStack.push(node.value) //token

    //Non-terminals.
    switch(node.name) {
      //"factor" rule is called only for values; not expressions
      //with parentheses due to the "trim" option which eliminates
      //rules with 1 non-terminal tokens from the tree. (We used '!'
      //operator to cancel token production for '(' and ')'.)
      //All we need to check is whether a minus sign appears in front.
      case 'factor': {
        let value = tokenStack.pop();
        if (node.tokens.length === 2) { //yes, with minus.
          tokenStack.pop(); //remove the minus
          value = -value;
        }
        tokenStack.push(value);
        break;
      }
      //they are essentially the same at this point, precedence has
      //already been handled.
      case 'mult':
      case 'add': {
        //first item is "factor", remaining items are pairs of op and an
        //expression (right hand side)
        const tokenCount = node.tokens.length * 2 - 1;
        const items = tokenStack.splice(tokenStack.length - tokenCount);

        let value = items.shift();
        while (items.length) {
          const op = items.shift();
          const rhs = items.shift();
          switch(op) {
            case '*': value = value * rhs; break;
            case '/': value = value / rhs; break; //Maybe a division by zero check here.
            case '+': value = value + rhs; break;
            case '-': value = value - rhs; break;
          }
        }
        tokenStack.push(value);
        break;
      }

      case 'program': result = tokenStack.pop(); break;
    }

    //depth-first post-order traversal so that parent nodes
    //have access to processed children in the token stack.
  }, {getChildren: node => node.tokens, order: "post"});

  //make sure we properly processed everything:
  if (tokenStack.length) throw new Error("Forgot to pop something from the token stack.");

  return result;
}


let program;

program = "42"; //check non operator expressions
console.log(program, " = ", calculate(program));

program = "5 - -5"; //check minus
console.log(program, " = ", calculate(program));

program = "8 / 4 / 2"; //check left associativity:
console.log(program, " = ", calculate(program));

program = "2 + 3 * 4"; //check operator precedence
console.log(program, " = ", calculate(program));

program = '3 * (4 + 1)'; //check exp with parentheses
console.log(program, " = ", calculate(program));

program = ".2 + 1.80"; //see if we can start with a dot
console.log(program, " = ", calculate(program));

program = "-(1+2)"; //minus before parens
console.log(program, " = ", calculate(program));

program = "0.1 + 0.2"; //lovely floating point representation issue
console.log(program, " = ", calculate(program));

