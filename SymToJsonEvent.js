// todo: make a good impl based on inner functions; after it's tested and benchmarked, inline all the functions and see if it improves things

const charCode0 = '0'.charCodeAt(0)
const charCode1 = '1'.charCodeAt(0)
const charCode9 = '9'.charCodeAt(0)
const charCodeLowerA = 'a'.charCodeAt(0)
const charCodeLowerF = 'f'.charCodeAt(0)
const charCodeUpperA = 'A'.charCodeAt(0)
const charCodeUpperF = 'F'.charCodeAt(0)

// todo?: perhaps Continue should be Ok
// todo?: maybe if eat before emit returns error, the parser should stop with error too
const Continue = {id: 'continue'}
const Mismatch = {id: 'mismatch'}

// todo?: make trailing commas invalid by treating first value different from next/last value

// might be useful to have open string and close string events
//    
// where you can decide to ignore the string -- same for key?
// this could make sense to ignore values of certain keys
//  could even set event granularity, e.g. events for substrings, where you could search strings for some needle

// todo: JsonEventType.true, ...

// todo?: replace f*alse, f[a]lse w/ f|alse, etc.

// todo: nice error msgs

// todo: check if next.push(type) is more optimal than next.push({type})
//    and if next.push('buffer', sym) is more optimal than next.push({type: 'buffer', sym})
//    another opton: next.push('buffer', {sym})

// todo: built-in line, col, pos information; in particular in returned {id: error} feedback msgs

// todo: more test suites

// SymToJson.make

// possible opt: dont emit eat on true, false, null (marginal)
// todo: should we continue to throw if (isDone) or ret error?

export const SymToJsonEvent = (next) => {
  let isDone = false
  let choiceId = 'initial'
  let parents = ['top']
  let hexSeqIdx = 0

  // todo: perhaps remove reset
  // ? todo: error recovery mechanism that doesn't reset state completely?
  const reset = () => {
    isDone = false
    choiceId = 'initial'
    parents = ['top']
    hexSeqIdx = 0
  }

  // todo?: remove, error on end shows only choiceId
  const dumpState = () => JSON.stringify({
    isDone, 
    choiceId, 
    parents,
  })

  const eat = (sym) => { return next.push({id: 'buffer', sym}) }
  const eatFork = (sym, nextChoiceId) => {
    choiceId = nextChoiceId
    return next.push({id: 'buffer', sym})
  }
  const eatPrefix = (sym) => { return next.push({id: 'whitespace', sym}) }
  const emit = (id, nextChoiceId) => {
    // todo: id -> type
    choiceId = nextChoiceId
    return next.push({
      id,
    })
  }

  // todo? in most cases eat, emitvalue could be replaced with eatemitvalue
  const emitValue = (id) => {
    const parent = parents[parents.length - 1]
    return emit(id, parent === 'top'? 'initial': 'value*')
  }

  const isZeroNine = (sym) => {
    const code = sym.charCodeAt(0)
    return code >= charCode0 && code <= charCode9
  }

  const isOneNine = (sym) => {
    const code = sym.charCodeAt(0)
    return code >= charCode1 && code <= charCode9
  }

  const isWhitespace = (sym) => {
    return sym === ' ' || sym === '\n' || sym === '\t' || sym === '\r'
  }

  // returning continue, next.push result, setting status ready for .end()
  // extracting repeated fragments

  const error = (message) => {
    // todo? special error status
    isDone = true
    return {id: 'error', message}
  }

  const value = (sym) => {
    switch (sym) {
      case '{': {
        parents.push('object')
        parents.push('key')
        return emit('open object', '*key')
      }
      case '[': {
        parents.push('array')
        return emit('open array', '*value')
      }
      case '"': return eatFork(sym, '"*')
      case 't': return eatFork(sym, 't*rue')
      case 'f': return eatFork(sym, 'f*alse')
      case 'n': return eatFork(sym, 'n*ull')
      case '-': return eatFork(sym, '-*')
      case '0': return eatFork(sym, '0*')
      default: {
        if (isOneNine(sym)) return eatFork(sym, '1-9*')
        if (isWhitespace(sym)) return eatPrefix(sym)

        // return {id: 'error', message: `Unexpected symbol in value ${sym}`}
        return Mismatch
      }
    }
  }
  const fraction = (sym) => {
    if (sym === '.') return eatFork(sym, '0-9.*')
    return exponent(sym)
  }
  const exponent = (sym) => {
    if ('eE'.includes(sym)) return eatFork(sym, 'exp*')
    return number(sym)
  }
  const number = (sym) => {
    // we assume here that sym is a non-numeric symbol that terminates the number
    // note: eatemitvalue is not suitable here
    emitValue('number')
    // the terminating symbol is part of what comes after the number -- essentially a space or a comma
    // let the standard flow handle that
    return self.push(sym)
  }

  const closeParent = (sym) => {
    const parent = parents[parents.length - 1]

    if (parent === 'object' && sym === '}') {
      parents.pop()
      // could eatEmitValue just as well
      return emitValue('close object')
    } 
    if (parent === 'array' && sym === ']') {
      parents.pop()
      // could eatEmitValue just as well
      return emitValue('close array')
    }
    return error(`Expected whitespace or comma or ${parent} close, got ${sym}`)
  }

  const self = {
    reset,
    isDone: () => isDone,
    push: (sym) => {
      if (isDone) {
        throw Error(`PUSH: Matcher already completed! ${dumpState()}`)
      }

      // todo: prioritize? order by most often hit branches first
      switch (choiceId) {
        case 'initial': {
          const ret = value(sym)
          if (ret === Mismatch) {
            return error(`Unexpected top-level symbol ${sym}`)
          }
          return ret
        }
        case '*value': {
          const ret = value(sym)
          if (ret === Mismatch) return closeParent(sym)
          return ret
        } 
        case 'value*': {
          if (sym === ',') {
            const parent = parents[parents.length - 1]

            if (parent === 'object') {
              parents.push('key')
              return emit('comma', '*key')
            } 
            if (parent === 'array') return emit('comma', '*value')
            return error(`Unexpected parent ${parent}`)
          }
          if (isWhitespace(sym)) return eatPrefix(sym)
          return closeParent(sym)
        } 
        case '*key': {
          if (sym === '"') return eatFork(sym, '"*')
          if (sym === '}') {
            parents.pop()
            parents.pop()
            // eatemitvalue would work here too
            return emitValue('close object')
          } 
          if (isWhitespace(sym)) return eatPrefix(sym)
          
          return error(`Expected whitespace or " or object close, got ${sym}`)
        } 
        case 'key*': {
          // todo: emit key either on +close string or :
          if (sym === ':') {
            parents.pop()
            return emit('colon', '*value')
          } 
          if (isWhitespace(sym)) return eatPrefix(sym)
          
          return error(`Expected : or whitespace, got ${sym}`)
        }
        case '"*': {
          if (sym === '"') {
            const parent = parents[parents.length - 1]
            // note: eatemitvalue
            eat(sym)
            if (parent === 'key') return emit('key', 'key*')
            return emitValue('string')
          } 
          if (sym === '\\') return eatFork(sym, '\\*')
          
          const code = sym.charCodeAt(0)
          if (code >= 0x0020 && code <= 0x10ffff) return eat(sym)
          
          return error(`Unexpected control character: ${code}`)
        } 
        case '\\*': {
          if ('"\\/bfnrt'.includes(sym)) return eatFork(sym, '"*')
          if (sym === 'u') return eatFork(sym, '\\u*')
          
          return error(`Invalid escape character: ${sym}`)
        } 
        case '\\u*': {
          // '0123456789abcdefABCDEF'.includes(sym)
          const code = sym.charCodeAt(0)
          if (
            (code >= charCode0 && code <= charCode9) ||
            (code >= charCodeLowerA && code <= charCodeLowerF) ||
            (code >= charCodeUpperA && code <= charCodeUpperF)
          ) {
            if (hexSeqIdx < 3) {
              hexSeqIdx += 1
              return eat(sym)
            }

            hexSeqIdx = 0
            return eatFork(sym, '"*')
          } 

          return error(`Invalid hexadecimal escape character: ${sym}`)
        } 
        case '-*': {
          if (sym === '0') return eatFork(sym, '0*')
          
          if (isOneNine(sym)) return eatFork(sym, '1-9*')

          return error(`Expected -[0-9], got -[${sym}]`)
        } 
        case '0*': return fraction(sym)
        case '1-9*': {
          if (isZeroNine(sym)) return eatFork(sym, '1-90-9*')
          else return fraction(sym)
        } 
        case '0-9.*': {
          if (isZeroNine(sym)) return eatFork(sym, '0-9.0-9*')
          
          return error(`Expected 0-9, got ${sym}`)
        } 
        case 'exp*': {
          if ('+-'.includes(sym)) return eatFork(sym, 'exp+-*')
          
          if (isZeroNine(sym)) return eatFork(sym, 'exp+-0-9')

          return error(`Expected +-0..9, got ${sym}`)
        }
        case 'exp+-*': {
          if (isZeroNine(sym)) return eatFork(sym, 'exp+-0-9')

          return error(`Expected digit, got ${sym}`)
        } 
        case '1-90-9*': {
          if (isZeroNine(sym)) return eat(sym)
          return fraction(sym)
        } 
        case '0-9.0-9*': {
          if (isZeroNine(sym)) return eat(sym)
          return exponent(sym)
        }
        case 'exp+-0-9': {
          if (isZeroNine(sym)) return eat(sym)
          return number(sym)
        } 
        case 't*rue': {
          if (sym === 'r') return eatFork(sym, 'tr*ue')
          return error(`Expected t[r]ue, got t[${sym}]...`)
        } 
        case 'tr*ue': {
          if (sym === 'u') return eatFork(sym, 'tru*e')
          return error(`Expected tr[u]e, got tr[${sym}]...`)
        } 
        case 'tru*e': {
          if (sym === 'e') {
            eat(sym)
            return emitValue('true')
          }
          return error(`Expected tru[e], got tru[${sym}]...`)
        } 
        case 'f*alse': {
          if (sym === 'a') return eatFork(sym, 'fa*lse')
          return error(`Expected f[a]lse, got f[${sym}]...`)
        } 
        case 'fa*lse': {
          if (sym === 'l') return eatFork(sym, 'fal*se')
          return error(`Expected fa[l]se, got fa[${sym}]...`)
        } 
        case 'fal*se': {
          if (sym === 's') return eatFork(sym, 'fals*e')
          return error(`Expected fal[s]e, got fal[${sym}]...`)
        } 
        case 'fals*e': {
          if (sym === 'e') {
            eat(sym)
            return emitValue('false')
          }
          return error(`Expected fals[e], got fals[${sym}]...`)
        } 
        case 'n*ull': {
          if (sym === 'u') return eatFork(sym, 'nu*ll')
          return error(`Expected n[u]ll, got n[${sym}]...`)
        } 
        case 'nu*ll': {
          if (sym === 'l') return eatFork(sym, 'nul*l')
          return error(`Expected nu[l]l, got nu[${sym}]...`)
        } 
        case 'nul*l': {
          if (sym === 'l') {
            eat(sym)
            return emitValue('null')
          }
          return error(`Expected nul[l], got nul[${sym}]...`)
        }
        default: throw Error(`Invalid parser state: ${dumpState()}`)
      }
    },
    end: () => {
      if (isDone) {
        // todo: fix error msg
        throw Error(`END: Matcher already completed! ${dumpState()}`)
      }
      isDone = true

      switch (choiceId) {
        case 'initial': {
          // todo? or push event, then call next.end() w/o args
          return next.end({
            id: 'end',
          })
        }
        default: {
          // n_structure_unclosed_array.json
          if (['exp+-0-9', '1-9*', '1-90-9*', '0-9.0-9*', '0*'].includes(choiceId)) {
            if (parents[parents.length - 1] === 'top') {
              // eatemitvalue would not work here
              emitValue('number')
              return next.end({
                id: 'end',
              })
            }
            return error(`todo: invalid end state ${dumpState()}`)
          }

          // todo: case 'value*') return error('Unclosed array')
          // todo: case '*key') return error('Unclosed object')
          
          // todo: fix msg
          return error(`todo: invalid end state ${dumpState()}`)
        }
      }
    },
  }

  return self
}