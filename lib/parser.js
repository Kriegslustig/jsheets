var vm = require('vm')
var util = require('util')
var _ = require('underscore')

var fileHandler = require('../lib/fileHandler.js')
var utilities = require('../lib/utilities.js')

module.exports = Parser

function createParser () {
  return (new Parser)
}

function Parser () { return {
  funcsToString: function (funcArr) {
    var returnString
    funcArr = [''].concat(funcArr.map(utilities.caller('toString')))
    return funcArr.join('\n')
  },

  include: function (somePath) {
    var self = this
    return fileHandler.getJsheets(somePath).map(function (fileName) {
      var hooksStash = [self.getHooks('EOF'), self.getHooks('afterParse')]
      var fileString = self.parse(fileHandler.read(fileName)) || ''
      self.setHooks({
        onEOF: hooksStash[0],
        afterParse: hooksStash[1]
      })
      return fileString
    }).join('\n')
  },

  context: (function () {
    var sandbox = {
      returnString: '',
      $: {},
      css: function (cssObject) {
        if(!cssObject) return false
        if(typeof cssObject == 'object')
          _.each(cssObject, sandbox.css)
        else
          sandbox.returnString += cssObject
      },
      _: _,
      require: require,
      hooks: {
        EOF: [],
        afterParse: []
      },
      on: function (hook, func) {
        if(!sandbox.hooks[hook]) return false
        return (sandbox.hooks[hook].push(func) && (sandbox.hooks[hook].length - 1))
      }
    }
    sandbox.$ = new (require('../helpers/helpers.js'))(sandbox)
    return vm.createContext(sandbox)
  })(),

  getHooks: function (hook) {
    var returnVal
    if(!this.context.hooks[hook]) return false
    returnVal = _.clone(this.context.hooks[hook])
    this.context.hooks[hook] = []
    return returnVal
  },

  setHooks: function (hooksObject) {
    this.context.hooks = _.mapObject(this.context.hooks, function (funcs, hook) {
      return hooksObject[hook] || []
    })
    return true
  },

  exec: function (javaScriptString) {
    var returnString = ''
    try {
      vm.runInContext(javaScriptString, this.context)
    } catch (e) {
      console.error('Exception in your jsheets')
      console.error(javaScriptString)
      console.error(e)
      return false
    }
    returnString = this.cleanContext()
    return returnString
  },

  parseCssVars: function (cssString) {
    /*
      \$\.
      [\w\,\.\d\_\-\$]+
      (
        \(
        [^\(\)]*
        \)
      )*
    */
    var self = this
    var varRegex = /\$\.[\w\,\.\d\_\-\$]+(\([^\(\)]*\))*/gm
    if(!cssString) return '';
    cssString = cssString.replace(varRegex, function (match) {
      var $ = self.context.$
      return eval(match)
    })
    return cssString
  },

  split: function (jsheetsString) {
    /*
      ^[\s\t]*
      (
        (
          (
            (
              (
                [\.\#]?
                [\w\-_\d]+
              )
              |
              \*
            )
            |
            (
              (
                \[
                |
                \:{1,2}
              ){1}
              [\w\-_\d\*\^\~\|\=\"\$]+
              (
                \([^\)\;]+\)
              )?
              \]?
            )
          )+
          [\n\,\s\>\+\~]*
        )+
        |
        (
          \@media\s
          [^\{]*
        )
      )
      \{
      [^\}]*
      \}
      \n*
    */
    var cssRegex = /^[\s\t]*((((([\.\#]?[\w\-_\d]+)|\*)|((\[|\:{1,2}){1}[\w\-_\d\*\^\~\|\=\"\$]+(\([^\)\;]+\))?\]?))+[\n\,\s\>\+\~]*)+|(\@media\s[^\{]*))\{[^\}]*\}\n*/gm
    var cssRegexRes, returnLang
    if(!jsheetsString) return false
    cssRegexRes = cssRegex.exec(jsheetsString)
    if(!cssRegexRes) return ['js', jsheetsString, false]
    returnLang = jsheetsString.indexOf(cssRegexRes[0]) === 0 ? 'css' : 'js'
    return [returnLang].concat(this.splitAroundSubstring(cssRegexRes[0], jsheetsString))
  },

  splitAroundSubstring: function (substring, string) {
    var substringFirst = string.indexOf(substring)
    var substringLast = substringFirst + substring.length
    if(substringFirst === 0) {
      return [string.substr(0, substringLast), string.substr(substringLast)]
    } else {
      return [string.substr(0, substringFirst), string.substr(substringFirst)]
    }
  },

  interpret: function (someArr) {
    return (someArr[0] == 'js' ? this.exec(someArr[1]) : this.parseCssVars(someArr[1]))
  },

  makeIncludes: function (jsheetsString) {
    var self = this
    var includeRegex = /^include\ (\'|\")([^\)]*)\1$/gm
    jsheetsString = jsheetsString.replace(includeRegex, function (match, g1, g2) {
      return self.include(g2)
    })
    return jsheetsString
  },

  cleanContext: function () {
    var returnString = this.context.returnString
    this.context.returnString = ''
    return returnString
  },

  mergeContext: function (someContext) {
    return (this.context = _.extend(someContext, this.context))
  },

  runOnAfterParse: function (parsedCss) {
    this.getHooks('afterParse').forEach(function (hook) {
      parsedCss = hook(parsedCss)
    })
    return parsedCss
  },

  runOnEOF: function () {
    var returnString = ''
    vm.runInContext(
      'css((' + utilities.runArray.toString() + ')' +
      '(hooks.EOF))',
      this.context)
    returnString = this.cleanContext()
    return returnString ? '\n' + returnString : ''
  },

  parse: function (jsheetsString) {
    var splitJcss = []
    var buffer = ''
    var parsedCss = ''
    if(typeof jsheetsString != 'string') return false
    jsheetsString = this.makeIncludes(jsheetsString)
    do {
      splitJcss = this.split(jsheetsString)
      parsedCss += (buffer = this.interpret(splitJcss))
      if(buffer === false) return false
    } while (jsheetsString = splitJcss[2])
    parsedCss += this.runOnEOF()
    return this.runOnAfterParse(parsedCss)
  }
} }