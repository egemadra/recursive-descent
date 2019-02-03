
const Tokenizer = require("./BNFTokenizer.js");

class GrammarError extends Error {
  constructor (msg, line, col) {
    super(msg);
    this.name = 'GrammarError';
    this.message = msg + " @ line: " + line + ", col: " + col;
  }
}

class Rule {
  constructor (line, col) {
    this.name;
    this.isLexerRule;
    this.alternatives = [];
    this.line = line;
    this.col = col;
  }
}

class Alternative{
  constructor(){
    this.expressions = [];
    this.predicated = false;
  }
}

class Exp{
  constructor(type, value, isTerminal, line, col){
    this.type = type;
    this.value = value;
    this.isTerminal = isTerminal;
    this.q; //quantifier
    this.unwanted; //if true, removed from parsed tree.
    this.flatten; //if true, the tokens are appended to the parent rule and the rule is removed.
    this.line = line;
    this.col = col;
  }
}

module.exports = class Parser {

  constructor (src) {
    this.src = src;
    this.currentToken = null;
    this.tokenizer = new Tokenizer(src);
    this.rules = {}; //keys are rule names, values are Rule objects
    this.usedRules = {}; //keys are rule names, values are tokens used.
    this.anonymousRuleCount = 0; //to name anonymous rules
  }

  error (msg, line, col) {
    if (line == null) line = this.tokenizer.line;
    if (col == null) col = this.tokenizer.col;
    return new GrammarError(msg, line, col);
  }

  //Tries to match the currentToken with the type in the argument.
  //If found, consumes it by fetching a new token and returns the token;
  //If match was required and didn't match throw, otherwise return null.
  accept (type, required){
    if (type === this.currentToken.type){
      const retval = this.currentToken;
      this.currentToken = this.tokenizer.getToken(); //fill the lookahead
      return retval;
    }

    if (required)
      throw this.error(`Expected '${type}', but found '${this.currentToken.type}'
        with value '${this.currentToken.value}'.`);

    return null;
  }

  parse () {
    this.currentToken = this.tokenizer.getToken();
    const ret = this.parse_grammar();
    if (! ret) throw this.error("Expected grammar definition.");
    this.accept("eof", true);
    //check if the start rule is defined:
    if (! this.rules["program"]) throw this.error("Start rule 'program' is missing.");
    //check if any undefined rules are used:
    this.checkUndefinedRules();
    //check all rules for left recursion and non terminating rules:
    const rulesArray = Object.values(this.rules);

    rulesArray.forEach(rule => this.checkLeftRecursion(rule, {}));
    rulesArray.forEach(rule => this.checkEmpty(rule));
    rulesArray.forEach(rule => this.checkCommonPrefix(rule, {}, []));
    rulesArray.forEach(rule => {
      rule.alternatives.forEach(a => {
        if (a.predicated) return;
        a.expressions.forEach((e, i) => {
          this.checkCommonFirstSetForAdjacentExpressions(e, i, a.expressions, rule);
        });
      });
    });

    this.checkUnusedRules(); //not an error but a warning:

    //add an eof token at the end of the program:
    const eof = new Exp("#eof", "", true);
    eof.q = '1';
    for (const alt of this.rules["program"].alternatives)
      alt.expressions.push(eof);

    return this.rules;
  }

  //common prefix is when any 2 alternatives' first non-predicated
  //terminals are the same. When this happens we cannot find which
  //rule to apply.
  checkCommonPrefix (rule, firsts, path) {
    //collect all non predicated first terminals among all alternatives:
    //firsts = {}; where keys are terminal hashes, values are an array of
    //visited rule names.
    path.push(rule.name);
    for (const alt of rule.alternatives) {
      if (alt.predicated) continue;
      for (const exp of alt.expressions) {
        if (exp.isTerminal) {
            const hash = exp.type + ':' + exp.value;
            if (firsts[hash]) {
              //find the last common rule among two sets:
              let commonSets = [];
              let commonStarts = -1;
              for (let i = 0; i < path.length; i++) {
                if (path[i] !== firsts[hash][i]) {
                  commonStarts = i;
                  break;
                }
              }
              commonStarts = commonStarts <= 0 ? 0 : commonStarts - 1;
              commonSets.push(firsts[hash].slice(commonStarts));
              commonSets.push(path.slice(commonStarts));
              commonSets.forEach(cs => cs.push("'" + exp.value + "'"));

              let err = "Common prefix. Terminal '" + exp.value + "' can be the first terminal for rule '" +
              commonSets[0][0] + "' in at least 2 occasions. Offending paths are listed below:";
              err += "\n-------PATH 1-------\n";
              err += commonSets[0].join("\n");
              err += "\n\n-------PATH 2-------\n";
              err += commonSets[1].join("\n") + "\n\n";
              throw this.error(err, exp.line, exp.col);
            }
            firsts[hash] = path.slice(0);
        } else {
          this.checkCommonPrefix(exp.type === 'rule' ? exp.value : this.rules[exp.value], firsts, path);
        }
        //if first non-nullable item passes the test, skip remaining exps.
        if (exp.q === '1' || exp.q === '+') break;
      }
    }
    path.pop();
  }

  setFirstTerminalsOfExp (exp, arr) {
    if (exp.isTerminal) {
      arr.push(exp.type + ':' + exp.value)
      return arr;
    } else {
      const rule = exp.type === 'rule' ? exp.value : this.rules[exp.value];
      rule.alternatives.forEach(a => {
        if (a.predicated) return;
        const e = a.expressions[0];
        const ret = this.setFirstTerminalsOfExp(e, arr);
        arr.concat(ret);
      });
      return arr;
    }
  }

  //Following structure fails due to ambiguity. Catch them.
  //A: t? t
  //* and + are also bad as the first expression. (+ is okay as next)
  //TODO: Unfortunately, we currently cannot catch ',' overlap
  //in something like the below example, but maybe we don't need to.
  //'{' (property_assignment (',' property_assignment)* )? ','? '}'
  checkCommonFirstSetForAdjacentExpressions (exp, index, expressions, rule) {
    if (exp.q === '1') return;
    if (index + 1 === expressions.length) return;
    const arr1 = [];
    this.setFirstTerminalsOfExp(exp, arr1);
    let _index = index;
    while (true) {
      const next = expressions[++_index];
      if (! next) break;
      const arr2 = [];
      this.setFirstTerminalsOfExp(next, arr2);
      const common = arr1.filter(n => arr2.indexOf(n) > -1);
      if (common.length) {
        const msg = "Rule '" + rule.name + "' has expressions that compete to produce terminal '" + common + "'.";
        throw this.error(msg, rule.line, rule.col);
      }
      //ok no overlap. If next is + or 1, break because it cannot "fall through"
      if (next.q === '1' || next.q === '+') break;
    }
  }

  //checks for rules that are in the form: A: B?
  //these can potentially not create any terminals.
  checkEmpty (rule) {
    rule.alternatives.forEach(alt => {
      const solid = alt.expressions.find(exp => ["1", "+"].includes(exp.q));
      if (! solid) {
        throw this.error("'" + rule.name + "' can possibly produce nothing.", rule.line, rule.col);
      }
    });
  }

  checkUnusedRules () {
    const visitedList = new Set();
    if (this.rules["ignore"]) this.visitUsedRules(this.rules["ignore"], visitedList);
    this.visitUsedRules(this.rules["program"], visitedList);
    const unvisitedList = Object.keys(this.rules).
      filter(ruleName => ! visitedList.has(ruleName));
    if (unvisitedList.length)
      console.warn("Warning. Following rules are unreachable from the 'program': '" +
        unvisitedList.join(', ') + "'.");
  }

  visitUsedRules (rule, visitedList) {
    if (visitedList.has(rule.name)) return;
    visitedList.add(rule.name);
    for (const alt of rule.alternatives)
      for (const exp of alt.expressions)
        if (! exp.isTerminal)
          this.visitUsedRules(exp.type === 'rule' ? exp.value : this.rules[exp.value], visitedList);
  }

  checkLeftRecursion (rule, visitedList) {
    visitedList[rule.name] = true;

    for (const a of rule.alternatives){
      for (const e of a.expressions){
        if (! e.isTerminal) { //terminals cannot cause left recursion
          if (e.type === 'rule') { //parenthetical
            this.checkLeftRecursion(e.value, visitedList);
          } else {
            if (visitedList[e.value]) {
              throw this.error("Left recursion in rule '" + rule.name + "'", rule.line, rule.col);
            }
            const r = this.rules[e.value]; //id -> rule
            this.checkLeftRecursion(r, visitedList);
            visitedList[r.name] = false; //remove the rules that didn't cause any problem.
          }
        }

        //We found the first non-nullable, no need to check the remaining exps.
        if (e.q ==='1' || e.q === '+') break;
      }
    }
  }

  checkUndefinedRules () {
    const undefinedNames = Object.keys(this.usedRules)
      .filter(ruleName => ! (ruleName in this.rules));
    if (undefinedNames.length){
      const msg = undefinedNames.map(name => {
        return "'" + name + "', on line(s) " +
          this.usedRules[name].map(token => token.line).join(', ');
      }).join("\n");
      throw this.error("Following rule names are used but not defined: \n" + msg + ".");
    }
  }

  /****************************** grammar rules *******************************/
  /****************************** grammar rules *******************************/
  /****************************** grammar rules *******************************/

  parse_grammar () {
    // definition +
    let rule = this.parse_definition();
    if (! rule) return null;
    const rules = [rule];
    while (true) {
      rule = this.parse_definition();
      if (! rule) break;
      rules.push(rule);
    }
    return rules;
  }

  parse_definition () {
    // identifier (':' | '=') alternatives ';' ;
    const ruleNameToken = this.accept("id", false);
    if (! ruleNameToken) return null;
    const assignmentToken = this.accept(":", false) || this.accept("=", true);
    const ret = this.parse_alternatives();
    if (! ret) throw this.error("Expected alternatives.");
    this.accept(';', true);
    if (this.rules[ruleNameToken.value])
      throw this.error(`Duplicate rule: '${ruleNameToken.value}' is defined more than once.`);
    const r = new Rule(ruleNameToken.line, ruleNameToken.col);
    r.name = ruleNameToken.value;
    r.alternatives = ret;
    r.isLexerRule = assignmentToken.value === '=';
    if (r.isLexerRule){ //lexer rules have some restrictions
      for (const a of ret){
        if (a.expressions.length > 1) throw this.error("Lexer rules can contain only one expression per alternative.");
        if (! a.expressions[0].isTerminal) throw this.error("Lexer rules can contain only terminal definitions.");
        for (const e of a.expressions)
          if (e.q !== '1') throw this.error("Expression in lexer rules can't have quantifiers outside of regular expressions.");
      }
    }
    /*
    else {
      if (ruleNameToken.value === 'ignore')
        throw this.error("'ignore' is a special name, parser rules can't have that name.");
    }
    */
    this.rules[r.name] = r;
    return r;
  }

  parse_alternatives () {
    // alternative ('|' alternative)* ;
    let ret = this.parse_alternative();
    if (! ret) return null;
    const alternatives = [ret];
    while (true) {
      if (! this.accept("|", false)) break;
      ret = this.parse_alternative();
      if (! ret) throw this.error("Expected alternative.");
      alternatives.push(ret);
    }
    return alternatives;
  }

  parse_alternative () {
    // '@'? ( '<'? '!'? exp quantifier?)+ ;
    let predicated = !! this.accept("@", false);
    let flatten = !! this.accept("<", false);
    let unwanted = !! this.accept('!', false);

    let exp = this.parse_exp();
    if (! exp) return null;

    exp.q = this.parse_quantifier() || '1';
    exp.unwanted = unwanted;
    exp.flatten = flatten;
    //if (exp.isTerminal && exp.q !== '1') throw this.error("Terminals can't have quantifiers.");
    if (exp.isTerminal && exp.flatten) throw this.error("Terminals can't be flattened with '<'.");
    const expressions = [exp];

    while (true) {
      flatten = !! this.accept("<", false);
      unwanted = !! this.accept('!', false);
      exp = this.parse_exp();
      if (! exp) break;
      exp.q = this.parse_quantifier() || '1';
      exp.unwanted = unwanted;
      exp.flatten = flatten;
      //if (exp.isTerminal && exp.q !== '1') throw this.error("Terminals can't have quantifiers.");
      if (exp.isTerminal && exp.flatten) throw this.error("Terminals can't be flattened with '<'.");
      expressions.push(exp);
    }

    const a = new Alternative();
    a.predicated = predicated;
    a.expressions = expressions;
    return a;
  }

  parse_exp () {
    // identifier | string | regex | fn
    // | '(' alternatives ')' ( '=' identifier )?

    //first 4 are processed the same, except identifier is non-terminal
    for (const type of ["id", "regex", "string", "fn"]){
      const token = this.accept(type, false);
      if (token) {
        //add id to the used rules as we will need to check unused/overused rules
        if (type === 'id'){
          if (! this.usedRules[token.value]) this.usedRules[token.value] = [];
          this.usedRules[token.value].push(token);
        }
        return new Exp(type, token.value, type !== 'id', token.line, token.col);
      }
    }

    //'(' alternatives ')' ( '=' identifier )?
    //we simply create a new rule from the parenthetical expression.
    const ruleStartToken = this.accept('(', false);
    if (! ruleStartToken) return null;
    const alternatives = this.parse_alternatives();
    if (! alternatives) throw this.error("Expected alternatives.");
    this.accept(")", true);

    const r = new Rule(ruleStartToken.line, ruleStartToken.col);
    r.alternatives = alternatives;
    r.isLexerRule = false;
    //set the name. if renamed use, otherwise create anonymous rule name.
    r.name = ! this.accept("=", false)
      ? `anonymous-rule#${this.anonymousRuleCount++}`
      : this.accept("id", true).value
      ;

    if (this.rules[r.name])
      throw this.error(`Duplicate rule: '${r.name}' is defined more than once.`);

    this.rules[r.name] = r;
    return new Exp("rule", r, false, r.line, r.col);
  }

  parse_quantifier(){
    // '?' | '*' | '+'
    const ret = ["?", "*", "+"].map(q => this.accept(q, false)).find(q => q);
    return ret ? ret.value : null;
  }

}
