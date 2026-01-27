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
  let output = ''
  let inSingle = false
  let inDouble = false
  let escape = false
  let i = 0

  while (i < input.length) {
    const ch = input[i]

    if (escape) {
      output += ch
      escape = false
      i += 1
      continue
    }

    if (inSingle) {
      if (ch === '\\') {
        output += ch
        escape = true
        i += 1
        continue
      }
      if (ch === "'") {
        inSingle = false
        output += ch
        i += 1
        continue
      }
      output += ch
      i += 1
      continue
    }

    if (inDouble) {
      if (ch === '\\') {
        output += ch
        escape = true
        i += 1
        continue
      }
      if (ch === '"') {
        inDouble = false
        output += ch
        i += 1
        continue
      }
      output += ch
      i += 1
      continue
    }

    if (ch === '"') {
      inDouble = true
      output += ch
      i += 1
      continue
    }

    if (ch === "'") {
      inSingle = true
      output += ch
      i += 1
      continue
    }

    if (ch === '{' || ch === ',') {
      output += ch

      let j = i + 1
      while (j < input.length && /\s/.test(input[j])) {
        j += 1
      }

      if (j < input.length && /[A-Za-z0-9_]/.test(input[j])) {
        let k = j
        while (k < input.length && /[A-Za-z0-9_]/.test(input[k])) {
          k += 1
        }

        let l = k
        while (l < input.length && /\s/.test(input[l])) {
          l += 1
        }

        if (l < input.length && input[l] === ':') {
          // Only quote keys outside strings to avoid breaking tokens like "{KeyWord:...}".
          output += input.slice(i + 1, j)
          output += `"${input.slice(j, k)}"`
          output += input.slice(k, l)
          output += ':'
          i = l + 1
          continue
        }
      }

      i += 1
      continue
    }

    output += ch
    i += 1
  }

  return output
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
