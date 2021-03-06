/*-
 * Copyright 2014 Square Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Handles encryption.
 *
 * @param cryptographer  an instance of WebCryptographer (or equivalent).
 * @param key_promise    Promise<CryptoKey>, either RSA or shared key
 */
JoseJWE.Encrypter = function (cryptographer, key_promise) {
  var that = this;
  that.cryptographer = cryptographer;
  that.key_promise = key_promise;
  that.userHeaders = {};
};

/**
 * Adds a key/value pair which will be included in the header.
 *
 * The data lives in plaintext (an attacker can read the header) but is tamper
 * proof (an attacker cannot modify the header).
 *
 * Note: some headers have semantic implications. E.g. if you set the "zip"
 * header, you are responsible for properly compressing plain_text before
 * calling encrypt().
 *
 * @param k  String
 * @param v  String
 */
JoseJWE.Encrypter.prototype.addHeader = function (k, v) {
  this.userHeaders[k] = v;
};

/**
 * Performs encryption.
 *
 * @param plain_text  String
 * @return Promise<String>
 */
JoseJWE.Encrypter.prototype.encrypt = function (plain_text) {
  var that = this;
  /**
   * Encrypts plain_text with CEK.
   *
   * @param cek_promise  Promise<CryptoKey>
   * @param plain_text   string
   * @return Promise<json>
   */
  var encryptPlainText = function (cek_promise, plain_text) {
    var self = this;
    // Create header
    var headers = {};
    for(var i in self.userHeaders) {
      headers[i] = self.userHeaders[i];
    }
    headers.alg = self.cryptographer.getKeyEncryptionAlgorithm();
    headers.enc = self.cryptographer.getContentEncryptionAlgorithm();
    var jwe_protected_header = Utils.Base64Url.encode(JSON.stringify(headers));

    // Create the IV
    var iv = self.cryptographer.createIV();

    // Create the AAD
    var aad = Utils.arrayFromString(jwe_protected_header);
    plain_text = Utils.arrayFromString(plain_text);

    return self.cryptographer.encrypt(iv, aad, cek_promise, plain_text).then(function (r) {
      r.header = jwe_protected_header;
      r.iv = iv;
      return r;
    });
  };

  // Create a CEK key
  var cek_promise = that.cryptographer.createCek();

  // Key & Cek allows us to create the encrypted_cek
  var encrypted_cek = Promise.all([that.key_promise, cek_promise]).then(function (all) {
    var key = all[0];
    var cek = all[1];
    return this.cryptographer.wrapCek(cek, key);
  }.bind(this));

  // Cek allows us to encrypy the plain text
  var enc_promise = encryptPlainText.bind(that, cek_promise, plain_text)();

  // Once we have all the promises, we can base64 encode all the pieces.
  return Promise.all([encrypted_cek, enc_promise]).then(function (all) {
    var encrypted_cek = all[0];
    var data = all[1];
    return data.header + "." +
      Utils.Base64Url.encodeArray(encrypted_cek) + "." +
      Utils.Base64Url.encodeArray(data.iv) + "." +
      Utils.Base64Url.encodeArray(data.cipher) + "." +
      Utils.Base64Url.encodeArray(data.tag);
  });
};
