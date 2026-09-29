import { describe, expect, it } from "vitest";
import { analyzeLabel } from "./label";

describe("analyzeLabel", () => {
  it("reads a model after OCR paragraph spacing and preserves uncertain OCR characters", () => {
    const result = analyzeLabel("Model Name\n\nLegion 5 151AH7H", []);
    expect(result.fields).toEqual({
      model: "Legion 5 151AH7H",
      category: "Laptop",
    });
  });

  it("does not cross another field heading when a serial value is missing", () => {
    const result = analyzeLabel(
      "Serial Number:\n\nMTM: TESTPRODUCT123\n\nMO: TESTORDER456",
      [],
    );
    expect(result.fields.serial).toBeUndefined();
    expect(result.identifiers.map((item) => item.kind)).toEqual([
      "product",
      "order",
    ]);
  });

  it("tolerates leading OCR quote marks around a multiline model without rewriting identifiers", () => {
    const result = analyzeLabel(
      "‘Model Name(%! 5%):\n‘Legion 5 15IAH7H\n‘Manufactured for Lenovo\nS/N: TEST.SN/001\nMO: TEST-MO_123",
      [],
    );
    expect(result.fields).toEqual({
      model: "Legion 5 15IAH7H",
      manufacturer: "Lenovo",
      category: "Laptop",
      serial: "TEST.SN/001",
    });
    expect(result.identifiers).toContainEqual({
      label: "MO",
      kind: "order",
      value: "TEST-MO_123",
    });
    expect(analyzeLabel("S/N: ‘TESTSN001", []).fields.serial).toBeUndefined();
  });

  it("extracts a multilingual multiline model and keeps MTM and MO distinct", () => {
    const result = analyzeLabel(
      "Model Name(型号):\nLegion 5 15IAH7H\nManufactured for Lenovo\nS/N: TESTSN001 MTM: 82XX00TEST MO: TESTMO987\nINPUT: 20V 11.5A\nMfg Date: 2025/01/01",
      [],
    );
    expect(result.fields).toEqual({
      model: "Legion 5 15IAH7H",
      manufacturer: "Lenovo",
      serial: "TESTSN001",
      category: "Laptop",
    });
    expect(result.identifiers).toEqual([
      { label: "Serial number", value: "TESTSN001", kind: "serial" },
      { label: "MTM", value: "82XX00TEST", kind: "product" },
      { label: "MO", value: "TESTMO987", kind: "order" },
    ]);
  });

  it("does not choose between conflicting explicit serials", () => {
    const result = analyzeLabel("Serial Number: TESTSN001", [
      { value: "S/N: TESTSN002", format: "QR" },
    ]);
    expect(result.fields.serial).toBeUndefined();
    expect(
      result.identifiers.filter((item) => item.kind === "serial"),
    ).toHaveLength(2);
  });

  it("deduplicates matching OCR and barcode evidence without inventing a code type", () => {
    const result = analyzeLabel("Service Tag: TEST001", [
      { value: "S/N: TEST001", format: "CODE_128" },
      { value: "998877665544", format: "CODE_128" },
    ]);
    expect(result.fields.serial).toBe("TEST001");
    expect(result.identifiers.map((item) => item.kind)).toEqual([
      "serial",
      "unknown",
    ]);
  });

  it("preserves structured order and product codes without proposing a serial", () => {
    const result = analyzeLabel("", [
      { value: "MO: TESTORDER123; MTM: TESTPRODUCT456", format: "QR" },
    ]);
    expect(result.fields.serial).toBeUndefined();
    expect(result.identifiers.map((item) => item.kind)).toEqual([
      "order",
      "product",
    ]);
  });

  it("does not infer serials from arbitrary tokens, regulatory metadata, or URLs", () => {
    const result = analyzeLabel(
      "TESTSN001\nFCC ID: TESTFCC123\nIC: TESTIC456\nMAC: AA-BB-CC-DD-EE-FF\nMfg Date: 2025/01/01\nhttps://example.invalid/ S/N: TESTURL123",
      [
        { value: "https://example.invalid/?S/N: TESTURL456", format: "QR" },
        { value: "TESTUNTYPED123", format: "CODE_128" },
      ],
    );
    expect(result.fields).toEqual({});
    expect(result.identifiers.map((item) => item.kind)).toEqual([
      "unknown",
      "unknown",
    ]);
  });

  it("delimits labeled metadata from a serial on the same line", () => {
    const result = analyzeLabel(
      "S/N: TESTSN001 FCC ID: TESTFCC456 INPUT: 20V\nAsset Tag: TESTASSET123",
      [],
    );
    expect(result.fields.serial).toBe("TESTSN001");
    expect(result.identifiers.map((item) => item.kind)).toEqual([
      "serial",
      "asset",
    ]);
  });

  it.each([
    "S/N: unknown",
    "Serial Number: NOT PRESENT",
    "S/N: https://example.invalid",
    "Serial Number:\nModel: TESTMODEL123",
    "S/N: TESTSN001 TESTSN002",
  ])("rejects ambiguous or missing serial values: %s", (text) => {
    expect(analyzeLabel(text, []).fields.serial).toBeUndefined();
  });

  it("reads a serial printed below its label", () => {
    expect(analyzeLabel("Serial Number:\nTESTSN001", []).fields.serial).toBe(
      "TESTSN001",
    );
  });

  it.each([
    "Legion Tower 5",
    "TESTMODEL123",
    "ThinkCentre M90q",
    "Legion 5 Tower",
  ])(
    "does not classify a desktop or unknown model as a laptop: %s",
    (model) => {
      expect(
        analyzeLabel(`Model: ${model}`, []).fields.category,
      ).toBeUndefined();
    },
  );

  it("does not select conflicting model or manufacturer proposals", () => {
    expect(
      analyzeLabel(
        "Model: ThinkPad T14\nModel: Latitude 7420\nManufacturer: Lenovo\nManufacturer: Dell",
        [],
      ).fields,
    ).toEqual({});
  });

  it("corroborates a damaged serial label with Lenovo's concatenated serial + MO code", () => {
    const result = analyzeLabel(
      "Manufactured for Lenovo\nSAN: TESTSN001\nMO: TESTMO123",
      [{ value: "testsn001TESTMO123", format: "QR" }],
    );
    expect(result.fields.serial).toBe("TESTSN001");
    expect(result.identifiers).toContainEqual({
      label: "Serial (text + QR)",
      value: "TESTSN001",
      kind: "serial",
    });
    expect(result.identifiers).toContainEqual({
      label: "Code (QR)",
      value: "testsn001TESTMO123",
      kind: "unknown",
    });
  });

  it.each([
    "SAN: TESTSN001\nMO: TESTMO123",
    "Manufactured for Dell\nSAN: TESTSN001\nMO: TESTMO123",
    "Manufactured for Lenovo\nSAN: TESTSN001",
    "Manufactured for Lenovo\nSAN: TESTSN002\nMO: TESTMO123",
    "Manufactured for Lenovo\nSAN: XTESTSN001\nMO: TESTMO123",
    "Manufactured for Lenovo\nFCC ID: TESTSN001\nMO: TESTMO123",
    "Manufactured for Lenovo\nMTM: TESTSN001\nMO: TESTMO123",
  ])(
    "does not split a concatenated code without all independent evidence: %s",
    (text) => {
      expect(
        analyzeLabel(text, [{ value: "testsn001TESTMO123", format: "QR" }])
          .fields.serial,
      ).toBeUndefined();
    },
  );

  it("does not let corroboration override a conflicting explicitly labeled serial", () => {
    const result = analyzeLabel(
      "Manufactured for Lenovo\nSerial Number: TESTSN002\nSAN: TESTSN001\nMO: TESTMO123",
      [{ value: "testsn001TESTMO123", format: "QR" }],
    );
    expect(result.fields.serial).toBeUndefined();
  });

  it("restricts concatenation corroboration to QR evidence", () => {
    const result = analyzeLabel(
      "Manufactured for Lenovo\nSAN: TESTSN001\nMO: TESTMO123",
      [{ value: "testsn001TESTMO123", format: "Code128" }],
    );
    expect(result.fields.serial).toBeUndefined();
  });
});
