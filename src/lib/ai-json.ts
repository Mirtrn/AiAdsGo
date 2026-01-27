export function repairJsonText(input: string): string {
  let text = input.trim()
  if (!text) return text

  text = text.replace(/^\uFEFF/, '')
  text = text.replace(/,\s*([}\]])/g, '$1')
  text = text.replace(/[“”]/g, '"')
  text = text.replace(/[‘’]/g, "'")
  text = text.replace(/:\s*=/g, ':')
  text = text.replace(/=\s*:/g, ':')

  text = quoteUnquotedKeys(text)
  text = convertSingleQuotedStrings(text)

  return text
}

function quoteUnquotedKeys(input: string): string {
  return input.replace(/([{,]\s*)([A-Za-z0-9_]+)\s*:/g, '$1"$2":')
}

function convertSingleQuotedStrings(input: string): string {
  let output = ''
  let inSingle = false
  let inDouble = false
  let escape = false

  for (let i = 0; i < input.length; i++) {
    const ch = input[i]

    if (escape) {
      if (inSingle && ch === "'") {
        output += "'"
      } else {
        output += '\\' + ch
      }
      escape = false
      continue
    }

    if (ch === '\\' && (inSingle || inDouble)) {
      escape = true
      continue
    }

    if (inSingle && ch === '"') {
      output += '\\"'
      continue
    }

    if (!inSingle && ch === '"') {
      inDouble = !inDouble
      output += ch
      continue
    }

    if (!inDouble && ch === "'") {
      inSingle = !inSingle
      output += '"'
      continue
    }

    output += ch
  }

  if (escape) {
    output += '\\'
  }

  return output
}
