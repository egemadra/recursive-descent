const ID_REGEX = new RegExp(/^[A-Za-z_][A-Za-z0-9_]*/);
const COMMENT_REGEXES = [
  new RegExp(/^\/\/[^\n]*/), //line
  //new RegExp(/^\*(\*(?!\/)|[^*])*\*/), //TODO: why is it not working?
];

class Token {
  constructor (type, value, line, col) {
    //possible types are: id, string, regex, fn, eof
    this.type = type;
    this.value = value;
    this.line = line;
    this.col= col;
  }
}

class BNFTokenizerError extends Error {
  constructor (msg, line, col) {
    super(msg);
    this.name = 'BNFTokenizerError'
    this.message = msg + " @ line: " + line + ", col: " + col;
  }
}

module.exports = class Tokenizer {

  constructor (grammar) {
    this.source = grammar;
    this.pos = 0;
    this.line = 1;
    this.col = 1;
  }

  error (msg, line, col) {
    return new BNFTokenizerError(msg, line, col);
  }

  advanceChar () {
    const char = this.source.substr(this.pos, 1);
    const ret = [char, this.line, this.col];

    this.pos ++;

    if (char === "\n") {
      this.line++;
      this.col = 1;
    } else
      this.col++;

    return ret;
	}

  getToken () {
    while (true) {
      //*************************************************************** comments
      const commentMatch = COMMENT_REGEXES.map(r => this.source.substr(this.pos).match(r)).find(r => r);
      if (commentMatch) {
        commentMatch[0].split('').forEach(i => this.advanceChar());
        continue;
      }

      /*************** read first char ***********/
      const [char, line, col] = this.advanceChar();
      /*************** read first char ***********/

      //************************************************************* whitespace
      if (["\t", " ", "\r", "\n"].includes(char)) continue;
      //******************************************************************** eof
      if (char === "") return new Token("eof", "", line, col);
      //****************************************************************** regex
      if (char === '~') {
        let buf = "~";
        while (true) {
          let next = this.advanceChar()[0];
          if (next === "") throw this.error("Regex pattern past end of file.", line, col);
          if (next === "\\") {
            next = this.advanceChar()[0];
            if (next === "") throw this.error("Regex pattern past end of file.", line, col);
            if (next === '~') { buf += "\~"; continue; } else buf += "\\";
          }
          if (next === '~') {
            //TODO: this is problematic. We only check for 'i'. What else could it be?
            //Read char without affecting line and col. If caseflag exists,
            //call advance char for "reading" it.
            const caseFlag = this.source.substr(this.pos, 1) === 'i' ? 'i' : undefined;
            if (caseFlag) this.advanceChar();

            try {
              new RegExp(buf.substr(1), caseFlag);
            } catch (err) {
              throw this.error(err, line, col);
            }
            buf += "~";
            if (caseFlag) buf += caseFlag;
            return new Token("regex", buf, line, col);
          }
          buf += next;
        }
      }
      //********************************************************* string literal
      if (char === "'") {
        let buf = '';
        while (true) {
          const delimiter = "'";
          const next = this.advanceChar()[0]
          if (next === "") return this.error("String literal past end of file.", line, col);
          //escape sec:
          if (delimiter === "'" && next === '\\') {
            const next = this.advanceChar()[0]; //add to the sequence whatever is escaped
            if (next === '') return this.error("String literal past end of file.", line, col);
            buf += next;
            continue;
          }
          if (next === delimiter)
            return new Token("string", buf, line, col);

          buf += next;
        }
      }
      //********************************************************** user function
      if (char === '$') {
        const match = this.source.substr(this.pos).match(ID_REGEX);
        if (! match) return this.error("Function symbol $ not followed by a valid callback name.");
        for (let i = 0; i < match[0].length; i++) this.advanceChar();
        return new Token("fn", match[0], line, col);
      }
      //****************************************************** control character
      if (";:+*?|()~=!<@".indexOf(char) > -1) return new Token(char, char, line, col);
      //************************************************************* identifier
      //We have already consumed 1 char, take into consideration
      const match = this.source.substr(this.pos - 1).match(ID_REGEX);
      if (match) {
        for (let i = 0; i < match[0].length - 1; i++) this.advanceChar();
        return new Token("id", match[0], line, col);
      }

      //************************************************************** exhausted
      throw this.error("Lexical error, no tokens match. Last read char is '" + char + "'", line, col);
    }
  }

}
