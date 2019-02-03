
const BNFParser = require(__dirname + "/src/BNFParser.js")
const Parser = require(__dirname + "/src/Parser.js");

module.exports = {
  BNFParser,
  Parser,

  bnfParse (grammar) {
    const bnfParser = new BNFParser(grammar);
    return bnfParser.parse();
  },

  createParser (rules, program, options) {
    return new Parser(rules, program, options);
  },

  parse (rules, program, options) {
    const parser = new Parser(rules, program, options);
    return parser.parse();
  },

  registerLexerMethod(parser, ruleName, method) {
    return parser.registerLexerMethod(ruleName, method);
  },

  print (node) {
    return Parser.print(node);
  },

  walk (node, callbacks) {
    return Parser.walk(node, callbacks);
  }
}