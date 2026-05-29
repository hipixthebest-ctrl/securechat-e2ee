// Whisper E2E Encryption using Web Crypto API
class WhisperCrypto {
    constructor() {
        this.keyPair = null;
        this.sharedSecrets = new Map();
    }

    async initialize() {
        // Generate ECDH key pair
        this.keyPair = await window.crypto.subtle.generateKey(
            {
                name: 'ECDH',
                namedCurve: 'P-256'
            },
            true,
            ['deriveKey', 'deriveBits']
        );
    }

    async getPublicKey() {
        const publicKey = await window.crypto.subtle.exportKey(
            'spki',
            this.keyPair.publicKey
        );
        return btoa(String.fromCharCode(...new Uint8Array(publicKey)));
    }

    async importPublicKey(publicKeyStr) {
        const binaryDer = Uint8Array.from(
            atob(publicKeyStr),
            c => c.charCodeAt(0)
        );
        
        return await window.crypto.subtle.importKey(
            'spki',
            binaryDer,
            {
                name: 'ECDH',
                namedCurve: 'P-256'
            },
            true,
            []
        );
    }

    async establishSharedSecret(userId, theirPublicKeyStr) {
        const theirPublicKey = await this.importPublicKey(theirPublicKeyStr);
        
        const sharedSecret = await window.crypto.subtle.deriveKey(
            {
                name: 'ECDH',
                public: theirPublicKey
            },
            this.keyPair.privateKey,
            {
                name: 'AES-GCM',
                length: 256
            },
            true,
            ['encrypt', 'decrypt']
        );

        this.sharedSecrets.set(userId, sharedSecret);
        return sharedSecret;
    }

    async encryptMessage(plaintext, userId) {
        const key = this.sharedSecrets.get(userId);
        if (!key) throw new Error('No shared secret established with this user');

        const iv = window.crypto.getRandomValues(new Uint8Array(12));
        const encoder = new TextEncoder();
        const encodedMessage = encoder.encode(plaintext);

        const ciphertext = await window.crypto.subtle.encrypt(
            {
                name: 'AES-GCM',
                iv: iv
            },
            key,
            encodedMessage
        );

        // Combine IV and ciphertext
        const combined = new Uint8Array(iv.length + ciphertext.byteLength);
        combined.set(iv, 0);
        combined.set(new Uint8Array(ciphertext), iv.length);

        return btoa(String.fromCharCode(...combined));
    }

    async decryptMessage(ciphertextStr, userId) {
        const key = this.sharedSecrets.get(userId);
        if (!key) throw new Error('No shared secret established with this user');

        const combined = Uint8Array.from(
            atob(ciphertextStr),
            c => c.charCodeAt(0)
        );

        const iv = combined.slice(0, 12);
        const ciphertext = combined.slice(12);

        const decrypted = await window.crypto.subtle.decrypt(
            {
                name: 'AES-GCM',
                iv: iv
            },
            key,
            ciphertext
        );

        const decoder = new TextDecoder();
        return decoder.decode(decrypted);
    }
}

const crypto = new WhisperCrypto();
