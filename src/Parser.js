//https://wincent.com/wiki/ANTLR_predicates

class Token {
  constructor (type, value, src, line, col) {
    this.type = type; //regex, string, fn, #eof
    this.value = value; //value of regex or string, '' for #eof, callback for fn
    this.src = src; //original regex or string used to match. '' for #eof.
    this.line = line;
    this.col= col;
  }
}

class Rule {
  constructor (name) {
    this.name = name;
    this.tokens = [];
    //this.basedOnToken; //for lexer tokens
    this.isLexerRule = false;
    this.value; //for lexer tokens
  }
  getNodeType () { return "Rule"; }
  //getParent () { return parents.get(this); }
}

class ParserException extends Error {
  constructor (msg, line, col) {
    super(msg);
    this.message = msg + " @ line: " + line + ", col: " + col;
  }
}

module.exports = class Parser {

  constructor (rules, source, options) {
    this.options = Object.assign({
      trim: false,
      notrim: [],
      exclude: [],
      accept: null,
    }, options || {});

    this.rules = rules;
    this.source = source;
    this.pos = 0;
    this.line = 1;
    this.col = 1;
    this.curToken = null; //stack of all tokens in the program.
    this.tokens = []; //token stack.
    this.tokenPointer = -1; //stats with ++
    //predicateLevel increased when @ is seen, decreased when the alternative
    //containing @ succeeds. If > 0 and a follow list fails, alternative is
    //abandoned instead of throwing an error.
    this.predicateLevel = 0;
    //custom lexer methods. keys are method names, values are callbacks in the
    //form of
    this.registeredLexerMethods = {};
    //terminals of the grammar, not the program. to be filled from the grammar file.
    const terminals = this.separateLexerRules(Object.values(this.rules), {});
    this.terminals = Object.values(terminals);
  }

  separateLexerRules (rules, terminals) {
    rules.forEach(rule => {
      rule.alternatives.forEach(alt => {
        alt.expressions.filter(exp => exp.isTerminal).forEach(exp => {
          const hash = exp.type + ":" + exp.value;
          terminals[hash] = {type: exp.type, value: exp.value};
          //mark the ignore terminals as such:
          if (rule.name === 'ignore') terminals[hash].isIgnore = true;
        });
        //also process terminals that are hidden in unnamed rules (exp rules):
        const expRules = alt.expressions.filter(exp => exp.type === 'rule').map(exp => exp.value);
        this.separateLexerRules(expRules, terminals);
      });
    });
    return terminals;
  }

  error (msg, line, col) {
    if (line == undefined) line = this.line;
    if (col === undefined) col = this.col;
    return new ParserException(msg, line, col);
  }

  parse () {
    //read all tokens in the source first. If errs occur, we better
    //know here. Also, due to backtracking, we need to go back to a consumed
    //token, therefore token list is implemented as a stack.
    let token;
    do {
      token = this.getToken();
      this.tokens.push(token);
    } while (token.type !== '#eof');
    /*
    //combine the lexer rules with parser rules
    for (var ruleName in this.lexerRules)
      this.rules[ruleName] = this.lexerRules[ruleName];
    */
    this.getSym(); //put one lookahead token up.
    this.program = this.drive(this.rules["program"], true);
    return this.program;
  }

  getSym () {
    return this.curToken = this.tokens[++this.tokenPointer];
  }

  setSym (pointer) {
    this.tokenPointer = pointer;
    return this.curToken = this.tokens[this.tokenPointer];
  }

  //tries to match a terminal token, by type and value. then consumes it.
  accept (type, value, mustMatch) {
    if (type === this.curToken.type && value === this.curToken.src) {
      const retval = this.curToken;
      this.getSym(); //fill the lookahead
      if (this.options.accept) this.options.accept(retval);
      return retval;
    }

    if (mustMatch)
      throw this.error(`Expected '${type}', but found '${this.curToken.type}'
        with value '${this.curToken.value}'.`, this.curToken.line, this.curToken.col);
  }

  prepareNode (rule, exp, node) {
    if (exp.unwanted) return; //don't add unwanted tokens
    if (exp.isTerminal) {
      if (typeof this.options.exclude === 'function') {
        if (this.options.exclude(exp)) return;
      } else {
        if (this.options.exclude.includes(exp.value)) return;
      }
    }

    if (! exp.flatten) {
      rule.tokens.push(node);
      //parents.set(node, rule);
    } else { //flattening means adding tokens of a child rule to the parent.
      rule.tokens = rule.tokens.concat(node.tokens);
      //node.tokens.forEach(t => parents.set(t, rule));
    }
  }

  lexerRulifyRule (rule, token) {
    rule.value = token.value;
    //rule.basedOnToken = token;
    rule.isLexerRule = true;
  }

  drive (baseRule, mustMatch) {
    //var base = this.rules[ruleName];
    const rule = new Rule(baseRule.name);

    //loop the alternatives. first exp that match assumes the alteranative
    //is found unless alt is predicated. If alternative has a predicate,
    //failing to match a required exp in the follow list is not an error.
    for (const alt of baseRule.alternatives) {
      let alternativeFound = false;
      if (alt.predicated) this.predicateLevel++;
      const tokenPointer = this.tokenPointer; //back up, in case restore needed.
      //loop the expressions.
      //if an expression matches, all the remaining ones must match,
      //meaning that alternative worked, or the alternative is discarded.
      for (const exp of alt.expressions) {
        //expMustMatch=true signifies that we already found the path, so not
        //matching an expression is an error and must throw unless predicated.
        const expMustMatch = ! this.predicateLevel && alternativeFound && (exp.q === '1' || exp.q === '+');
        let ret = this.makeCall(exp, expMustMatch);
        if (ret) { //found. assume the alternative is found too.
          alternativeFound = true;
          baseRule.isLexerRule ? this.lexerRulifyRule(rule, ret) : this.prepareNode(rule, exp, ret);

        } else { //not found
          //if this expression is optional continue with the remaining exps.
          if (exp.q === '?' || exp.q === '*') continue;
          //ok, exp was required and not found, so abandon the alternative.
          //execution comes here when alt is predicated so makeCall didn't throw.
          alternativeFound = false;
          break;
        }

        //common in both initial and follow: loops.
        //try the exp as long as it matches.
        if (alternativeFound && (exp.q === '+' || exp.q === '*')) {
          while (true) {
            ret = this.makeCall(exp, false);
            if (! ret) break;
            this.prepareNode(rule, exp, ret);
          }
        }
      };

      //alternatives continue.
      if (alt.predicated) this.predicateLevel--;

      if (alternativeFound) {
        //Experimental trim functions from the old php code.
        //if (rule.tokens.length === 1 && rule.tokens[0] instanceof Rule) return rule.tokens[0];
        //if (rule.tokens.length === 1) return rule.tokens[0];
        //if (rule.tokens.every(t => t instanceof Token)) return rule;
        const skip =
          this.options.trim && rule.tokens.length === 1
          && ! this.options.notrim.includes(rule.name)
          && rule.tokens[0] instanceof Rule
          && ! rule.tokens[0].isLexerRule;

        if (skip) return rule.tokens[0];
        return rule;
      } else {
        //alternative is not found.
        //If the alt failed due to a predicate, that means we read some tokens
        //from the tokenStack and pushed them into the rule's tokens.
        //Now we have to reset them here so that next alternative can make a
        //clean start.
        rule.tokens = [];
        //reset the stack to where it was before the alternative had been attempted.
        this.setSym(tokenPointer);
      }
    }

    //no alternatives matched while the rule was required:
    if (mustMatch) {
      var msg = `Expected '${baseRule.name}' but not found. Last terminal read is a`+
        ` '${this.curToken.type}' with value '${this.curToken.value}'.`;
      throw this.error(msg, this.curToken.line, this.curToken.col);
    }
  }

  //makeCall simulates a call to a rule definition or accepting a token in a
  //recursive descent parser had we been generating code.
  makeCall (exp, mustMatch) {
    switch(exp.type){
      case 'string': case 'regex': case 'fn': //these 3 are inline anonymous tokens.
        return this.accept(exp.type, exp.value, mustMatch);
      case 'id': //rules.
        const rule = this.rules[exp.value];
        return this.drive(rule, mustMatch);
      case '#eof': //this is auto-created and added to the alts of "program" rule.
        return this.accept('#eof', '', mustMatch);
      case 'rule': // ( ... ) kind of exps, we converted them to rules.
        return this.drive(exp.value, mustMatch);
      default:
        //this can't really happen but still...
        throw new Error("Some internal error occured. An expression with a "+
          "different type than the grammar analyser can produce found. ");
    }
  }

  /**************************** TOKENIZER ***************************/
  /**************************** TOKENIZER ***************************/
  /**************************** TOKENIZER ***************************/
  registerLexerMethod (ruleName, method) {
    this.registeredLexerMethods[ruleName] = method;
  }

  createToken (t) {
    const token = new Token(t.type, t.value, t.src, this.line, this.col);
    //adjust col, pos and line:
    //registered lexers may return length field, cater that.
    const len = t.length == undefined ? t.value.length : t.length;
    for (let i=0; i < len; i++)
      if (t.value[i] === "\n") {
        this.col = 1;
        this.line++ ;
      } else this.col++ ;

    this.pos += len;
    //After the adjustment, we consume ignore tokens internally and never return them.
    if (t.isIgnore) return this.getToken();
    return token;
  }

  //tries to match the input against all of te lexer rules and returns the
  //longest one. Not matching anything is lexical error.
  getToken () {
    const source = this.source.substr(this.pos);
    if (source === '') return this.createToken({type: "#eof", src: '', value: ''});

    const matches = [];

    for (const term of this.terminals) {
      if (term.type === 'string') {
        if (source.startsWith(term.value))
          matches.push({type: term.type, src: term.value, value: term.value, isIgnore: term.isIgnore});
      } else if (term.type === 'regex') {
        const parts = term.value.split('~');
        const flag = parts.pop() === 'i' ? 'i' : undefined;
        parts.shift();
        const pattern = "^" + parts.join('~');
        if (source.search(pattern, flag) === 0)
          matches.push ({
            type: term.type,
            src: term.value,
            value: new RegExp(pattern, flag).exec(source)[0],
            isIgnore: term.isIgnore
          });
      } else if (term.type === 'fn'){
        const method = this.registeredLexerMethods[term.value];
        if (! method || typeof method !== 'function')
          throw this.error("Lexer method named '" + term.value + "' is not registered or is not a function.");
        const ret = method(this.source.substr(this.pos));
        if (ret == null) continue;
        if (typeof ret === 'string')
          matches.push({type: term.type, src: term.value, value: ret});
        else if (typeof ret === 'object') {
          matches.push({type: term.type, src: term.value, value: ret.value, length: ret.length});
        }
      } else {

      }
    }

    if (! matches.length)
      throw this.error("Lexical error: input stream did not match any tokens." +
        " '" + source[0] + "'(chr: "+source.charCodeAt(0)+") is the first character that is not recognized.");
    //among all the matches, return the longest one.
    //http://stackoverflow.com/questions/6521245/finding-longest-string-in-array/12548884#12548884
    //modified so that first among the equal length is chosen.
    const longest = matches.reduce( (a, b) => a.value.length >= b.value.length ? a : b );
    return this.createToken(longest);
  }

  /********************************* UTILS *********************************/
  /********************************* UTILS *********************************/
  /********************************* UTILS *********************************/

  static print (rule) {
    const printTree = require('print-tree');
    printTree(
      rule,
      node => {
        const isTerm = node instanceof Token || node.isLexerRule;
        const extra = isTerm ? ': ' + node.value : '';
        const name = node instanceof Token ? node.type : node.name;
        return name + extra;
      },
      node => node.tokens,
    );
  }

  static walk (rule, cb){
    if (cb.enter) cb.enter(rule);
    if (Array.isArray(rule.tokens))
      rule.tokens.forEach(t => Parser.walk(t, cb));
    if (cb.exit) cb.exit(rule);
  }

  print (rule) {
    Parser.print(rule);
  }

  walk (rule, cb) {
    Parser.walk(rule, cb);
  }
}
