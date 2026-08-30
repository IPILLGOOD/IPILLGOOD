"use client";

import { useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";

const CODE_LENGTH = 8;

function codeCharacters(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, CODE_LENGTH).split("");
}

export function ConnectionCodeInput() {
  const [characters, setCharacters] = useState<string[]>(() => Array(CODE_LENGTH).fill(""));
  const inputs = useRef<Array<HTMLInputElement | null>>([]);

  const placeCharacters = (start: number, value: string) => {
    const incoming = codeCharacters(value);
    if (!incoming.length) return;
    const next = [...characters];
    incoming.forEach((character, offset) => {
      if (start + offset < CODE_LENGTH) next[start + offset] = character;
    });
    setCharacters(next);
    inputs.current[Math.min(start + incoming.length, CODE_LENGTH - 1)]?.focus();
  };

  const handleKeyDown = (index: number, event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Backspace") {
      event.preventDefault();
      const next = [...characters];
      if (next[index]) next[index] = "";
      else if (index > 0) {
        next[index - 1] = "";
        inputs.current[index - 1]?.focus();
      }
      setCharacters(next);
      return;
    }
    if (event.key === "ArrowLeft" && index > 0) {
      event.preventDefault();
      inputs.current[index - 1]?.focus();
    }
    if (event.key === "ArrowRight" && index < CODE_LENGTH - 1) {
      event.preventDefault();
      inputs.current[index + 1]?.focus();
    }
  };

  const handlePaste = (event: ClipboardEvent<HTMLDivElement>) => {
    event.preventDefault();
    placeCharacters(0, event.clipboardData.getData("text"));
  };

  const rawCode = characters.join("");
  const formattedCode = rawCode.length > 4 ? `${rawCode.slice(0, 4)}-${rawCode.slice(4)}` : rawCode;

  return (
    <div
      className={rawCode.length === CODE_LENGTH ? "connection-code-input connection-code-input--complete" : "connection-code-input"}
      role="group"
      aria-labelledby="connection-code-label"
      onPaste={handlePaste}
    >
      <input name="code" type="hidden" value={formattedCode} />
      {characters.map((character, index) => (
        <span className={index === 4 ? "connection-code-input__cell connection-code-input__cell--group" : "connection-code-input__cell"} key={index}>
          {index === 4 ? <span className="connection-code-input__separator" aria-hidden="true">—</span> : null}
          <input
            ref={(element) => { inputs.current[index] = element; }}
            id={index === 0 ? "connection-code" : undefined}
            aria-label={`연결 코드 ${index + 1}번째 문자`}
            autoCapitalize="characters"
            autoComplete={index === 0 ? "one-time-code" : "off"}
            inputMode="text"
            maxLength={1}
            pattern="[A-Za-z0-9]"
            required
            value={character}
            onChange={(event) => {
              const nextValue = event.currentTarget.value;
              if (!nextValue) {
                const next = [...characters];
                next[index] = "";
                setCharacters(next);
                return;
              }
              placeCharacters(index, nextValue);
            }}
            onFocus={(event) => event.currentTarget.select()}
            onKeyDown={(event) => handleKeyDown(index, event)}
          />
        </span>
      ))}
      <span className="sr-only" role="status" aria-live="polite">
        {rawCode.length === CODE_LENGTH ? "연결 코드 8자리를 모두 입력했어요." : ""}
      </span>
    </div>
  );
}
