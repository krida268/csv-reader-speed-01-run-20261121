// Pembaca CSV rusak satu lintasan — kompatibel perilaku dengan csv-reader 1.0.0,
// tapi ditulis ulang dengan strategi berbeda: field diambil dengan slice besar,
// bukan dibangun karakter demi karakter.
//
// Ide kecepatannya:
//  - Field polos dipindai memakai charCodeAt sampai ketemu koma / LF / CRLF,
//    lalu dipotong sekali dengan slice. CR liar adalah pengecualian langka dan
//    ditangani jalur lambat terpisah yang menyambung segmen-segmen slice.
//  - Field berquote dicari ujungnya dengan indexOf('"'); potongan di antara
//    quote biasanya bisa langsung di-slice. Hanya potongan yang mengandung CR
//    yang perlu dikonversi (CRLF / CR tunggal menjadi LF).
//  - Hasil baca field disimpan di variabel bersama (fieldValue / fieldEnded /
//    fieldAdded), jadi tidak ada objek hasil yang dialokasi per field.
//
// Semantik yang dijaga persis:
//  - BOM U+FEFF di awal dibuang; baris kosong (LF / CRLF saja) bukan record.
//  - CR di luar quote yang tidak diikuti LF dibuang + error stray_cr.
//  - Di dalam quote: "" menjadi satu ", dan CRLF maupun CR tunggal menjadi LF
//    (keduanya menaikkan nomor baris, sama seperti LF biasa).
//  - Sisa teks sesudah quote penutup ditempel apa adanya sampai koma / line
//    break berikutnya; error quote_junk hanya bila ada karakter yang menempel.
//  - Quote yang tidak menutup sampai EOF: quote-nya jadi literal, error
//    unterminated_quote, lalu isi sesudahnya dibaca ulang sebagai field polos
//    dengan nomor baris dipulihkan ke baris saat quote dibuka.
//  - Record berisi satu field kosong polos yang lahir hanya dari CR-CR liar
//    bukan record (error-nya tetap tercatat).
//  - Lebar rows mengikuti record pertama; kekurangan field memicu short_row
//    lalu di-pad "", kelebihan memicu long_row dengan field sisa di extra.

// Cara field berakhir: koma (record lanjut), line break (record selesai),
// atau ujung teks (record selesai juga).
const ENDED_COMMA = 0;
const ENDED_BREAK = 1;
const ENDED_EOF = 2;

const CC_COMMA = 44;
const CC_LF = 10;
const CC_CR = 13;
const CC_QUOTE = 34;

export function run(input) {
  const text = String(input.text);
  const wantHeader = input.header === true;
  const len = text.length;

  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = 0; // indeks karakter berikutnya
  let line = 1; // baris tempat karakter itu berada
  if (text.charCodeAt(0) === 0xfeff) pos = 1;

  // Konteks record yang sedang dibaca, dipakai untuk semua error di dalamnya.
  let recordLine = 1;
  let recordRow = null;

  // Saluran hasil bersama untuk pembaca field (menghindari objek per field).
  let fieldValue = '';
  let fieldEnded = ENDED_EOF;
  let fieldAdded = 0; // karakter yang benar-benar ditempel oleh baca terakhir

  function noteError(code) {
    errors.push({ code, line: recordLine, row: recordRow });
  }

  // Hitung LF dalam text[a..b) — potongan tanpa CR dari field berquote.
  // indexOf memindai secara native, jauh lebih murah daripada loop per
  // karakter untuk potongan panjang; jumlah LF biasanya sedikit.
  function countNewlines(a, b) {
    let total = 0;
    let i = text.indexOf('\n', a);
    while (i !== -1 && i < b) {
      total++;
      i = text.indexOf('\n', i + 1);
    }
    return total;
  }

  // Konversi potongan text[a..b) yang mengandung CR: CRLF dan CR tunggal
  // sama-sama menjadi satu LF. Nomor baris global ikut diperbarui.
  function convertChunk(a, b) {
    const pieces = [];
    let segStart = a;
    let i = a;
    while (i < b) {
      const cc = text.charCodeAt(i);
      if (cc === CC_CR) {
        pieces.push(text.slice(segStart, i), '\n');
        line++;
        i += i + 1 < b && text.charCodeAt(i + 1) === CC_LF ? 2 : 1;
        segStart = i;
      } else {
        if (cc === CC_LF) line++;
        i++;
      }
    }
    pieces.push(text.slice(segStart, b));
    return pieces.join('');
  }

  // Jalur lambat field polos: mulai dari CR liar pertama di indeks strayAt.
  // Segmen bersih sebelum/sesudahnya tetap diambil dengan slice; tiap CR liar
  // dibuang dan dicatat. Mengembalikan lewat variabel bersama seperti jalur cepat.
  function readPlainSlow(prefix, strayAt) {
    const pieces = [prefix, text.slice(pos, strayAt)];
    let added = strayAt - pos;
    noteError('stray_cr');
    let i = strayAt + 1;
    let segStart = i;
    while (i < len) {
      const cc = text.charCodeAt(i);
      if (cc === CC_COMMA || cc === CC_LF) {
        pieces.push(text.slice(segStart, i));
        added += i - segStart;
        fieldValue = pieces.join('');
        fieldAdded = added;
        pos = i + 1;
        if (cc === CC_LF) line++;
        fieldEnded = cc === CC_COMMA ? ENDED_COMMA : ENDED_BREAK;
        return;
      }
      if (cc === CC_CR) {
        if (i + 1 < len && text.charCodeAt(i + 1) === CC_LF) {
          pieces.push(text.slice(segStart, i));
          added += i - segStart;
          fieldValue = pieces.join('');
          fieldAdded = added;
          pos = i + 2;
          line++;
          fieldEnded = ENDED_BREAK;
          return;
        }
        pieces.push(text.slice(segStart, i));
        added += i - segStart;
        noteError('stray_cr');
        i++;
        segStart = i;
        continue;
      }
      i++;
    }
    pieces.push(text.slice(segStart, len));
    fieldValue = pieces.join('');
    fieldAdded = added + (len - segStart);
    pos = len;
    fieldEnded = ENDED_EOF;
  }

  // Baca field polos (atau lanjutan) mulai dari pos, menempel pada prefix.
  // Berhenti di koma, LF, CRLF, atau ujung teks.
  function readPlain(prefix) {
    let i = pos;
    while (i < len) {
      const cc = text.charCodeAt(i);
      if (cc === CC_COMMA || cc === CC_LF) break;
      if (cc === CC_CR) {
        if (i + 1 < len && text.charCodeAt(i + 1) === CC_LF) break;
        readPlainSlow(prefix, i);
        return;
      }
      i++;
    }
    fieldAdded = i - pos;
    fieldValue = prefix === '' ? text.slice(pos, i) : prefix + text.slice(pos, i);
    if (i >= len) {
      pos = len;
      fieldEnded = ENDED_EOF;
      return;
    }
    if (text.charCodeAt(i) === CC_COMMA) {
      pos = i + 1;
      fieldEnded = ENDED_COMMA;
    } else if (text.charCodeAt(i) === CC_LF) {
      pos = i + 1;
      line++;
      fieldEnded = ENDED_BREAK;
    } else {
      // CR yang diikuti LF.
      pos = i + 2;
      line++;
      fieldEnded = ENDED_BREAK;
    }
  }

  // Baca field yang diawali quote di pos.
  function readQuoted() {
    const openPos = pos;
    const openLine = line;
    pos++; // lewati quote pembuka
    let value = '';
    for (;;) {
      const q = text.indexOf('"', pos);
      if (q === -1) {
        // Tidak ada penutup sampai ujung teks: quote jadi literal dan isi
        // sesudahnya dibaca ulang sebagai field polos berawalan '"'.
        pos = openPos + 1;
        line = openLine;
        noteError('unterminated_quote');
        readPlain('"');
        return;
      }
      if (q > pos) {
        const crAt = text.indexOf('\r', pos);
        if (crAt === -1 || crAt >= q) {
          line += countNewlines(pos, q);
          value += text.slice(pos, q);
        } else {
          value += convertChunk(pos, q);
        }
      }
      if (q + 1 < len && text.charCodeAt(q + 1) === CC_QUOTE) {
        value += '"';
        pos = q + 2;
        continue;
      }
      pos = q + 1; // lewati quote penutup
      break;
    }
    // Sesudah quote penutup: koma / line break / EOF mengakhiri field dengan
    // bersih; apa pun selain itu adalah junk yang ditempel apa adanya.
    if (pos >= len) {
      fieldValue = value;
      fieldEnded = ENDED_EOF;
      return;
    }
    const cc = text.charCodeAt(pos);
    if (cc === CC_COMMA) {
      pos++;
      fieldValue = value;
      fieldEnded = ENDED_COMMA;
      return;
    }
    if (cc === CC_LF) {
      pos++;
      line++;
      fieldValue = value;
      fieldEnded = ENDED_BREAK;
      return;
    }
    if (cc === CC_CR && pos + 1 < len && text.charCodeAt(pos + 1) === CC_LF) {
      pos += 2;
      line++;
      fieldValue = value;
      fieldEnded = ENDED_BREAK;
      return;
    }
    readPlain(value);
    if (fieldAdded > 0) noteError('quote_junk');
  }

  for (;;) {
    // Lewati baris yang tidak berisi karakter apa pun (LF / CRLF kosong).
    while (pos < len) {
      const cc = text.charCodeAt(pos);
      if (cc === CC_LF) {
        pos++;
        line++;
      } else if (cc === CC_CR && pos + 1 < len && text.charCodeAt(pos + 1) === CC_LF) {
        pos += 2;
        line++;
      } else {
        break;
      }
    }
    if (pos >= len) break;

    recordLine = line;
    recordRow = wantHeader && columns === null ? null : rows.length;

    const fields = [];
    let lastWasQuoted = false;
    do {
      if (text.charCodeAt(pos) === CC_QUOTE) {
        lastWasQuoted = true;
        readQuoted();
      } else {
        lastWasQuoted = false;
        readPlain('');
      }
      fields.push(fieldValue);
    } while (fieldEnded === ENDED_COMMA);

    // Satu field kosong polos yang hanya lahir dari CR liar bukanlah record.
    if (fields.length === 1 && fields[0] === '' && !lastWasQuoted) continue;

    if (width < 0) width = fields.length;
    if (wantHeader && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }

  return { columns: wantHeader ? (columns ?? []) : null, rows, errors };
}
