export function parseCsv(content: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false

  const input = content.replace(/^\uFEFF/, '')
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index]
    if (inQuotes) {
      if (character === '"') {
        if (input[index + 1] === '"') {
          field += '"'
          index += 1
        } else {
          inQuotes = false
        }
      } else {
        field += character
      }
      continue
    }

    if (character === '"' && field.length === 0) {
      inQuotes = true
    } else if (character === ',') {
      row.push(field)
      field = ''
    } else if (character === '\n' || character === '\r') {
      row.push(field)
      field = ''
      if (character === '\r' && input[index + 1] === '\n') index += 1
      if (row.some((cell) => cell.trim() !== '')) rows.push(row)
      row = []
    } else {
      field += character
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field)
    if (row.some((cell) => cell.trim() !== '')) rows.push(row)
  }
  return rows
}

export function csvEscape(value: unknown): string {
  const text = value == null ? '' : String(value)
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function serializeCsv(headers: string[], rows: unknown[][]): string {
  return [headers, ...rows].map((row) => row.map(csvEscape).join(',')).join('\r\n') + '\r\n'
}
