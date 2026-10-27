'use strict';

const blockedTerms = ['slur', 'spamword', 'badword', 'fuck', 'shit', 'bitch', 'asshole', 'dick', 'cunt', 'nigger', 'faggot'];
const separatedProfanity = /(s[\W_]*l[\W_]*u[\W_]*r|f[\W_]*u[\W_]*c[\W_]*k|s[\W_]*h[\W_]*i[\W_]*t|b[\W_]*i[\W_]*t[\W_]*c[\W_]*h|a[\W_]*s[\W_]*s[\W_]*h[\W_]*o[\W_]*l[\W_]*e|d[\W_]*i[\W_]*c[\W_]*k|c[\W_]*u[\W_]*n[\W_]*t|n[\W_]*i[\W_]*g[\W_]*g[\W_]*e[\W_]*r|f[\W_]*a[\W_]*g[\W_]*g[\W_]*o[\W_]*t|s[\W_]*p[\W_]*a[\W_]*m[\W_]*w[\W_]*o[\W_]*r[\W_]*d|b[\W_]*a[\W_]*d[\W_]*w[\W_]*o[\W_]*r[\W_]*d)/giu;

function censorChatText(value) {
  return String(value || '').normalize('NFKC').replace(/\p{L}+/gu, (word) => {
    const normalized = word.toLowerCase().replace(/[^a-z]/g, '');
    return blockedTerms.some((term) => normalized.includes(term)) ? '\u2022\u2022\u2022' : word;
  }).replace(separatedProfanity, '\u2022\u2022\u2022');
}

module.exports = { censorChatText };