import * as assert from "assert";
import {encodeInstanceAuthority, decodeInstanceAuthority} from "../web/instanceUri";

describe("instance authority", () => {
    it("round-trips a url and tenant", () => {
        const instance = {url: "http://localhost:8080", tenant: "prod"};
        assert.deepStrictEqual(decodeInstanceAuthority(encodeInstanceAuthority(instance)), instance);
    });

    it("round-trips an empty tenant", () => {
        const instance = {url: "https://kestra.example.com/api/v1", tenant: ""};
        assert.deepStrictEqual(decodeInstanceAuthority(encodeInstanceAuthority(instance)), instance);
    });

    it("encodes to a lowercase hex authority", () => {
        assert.match(encodeInstanceAuthority({url: "http://localhost:8080", tenant: "main"}), /^[0-9a-f]+$/);
    });

    it("decodes whatever case the authority comes back in", () => {
        const instance = {url: "http://localhost:8080", tenant: "main"};
        assert.deepStrictEqual(decodeInstanceAuthority(encodeInstanceAuthority(instance).toUpperCase()), instance);
    });

    it("returns undefined for an authority this extension did not write", () => {
        for (const authority of ["", "github", "zz", "abc", "6162"]) {
            assert.strictEqual(decodeInstanceAuthority(authority), undefined);
        }
    });
});
