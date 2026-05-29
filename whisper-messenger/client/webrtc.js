class VoiceCall {
    constructor(socket, userId) {
        this.socket = socket;
        this.userId = userId;
        this.peerConnection = null;
        this.localStream = null;
        this.remoteStream = null;
        this.isCallActive = false;
        this.isMuted = false;
    }

    async startCall(recipientId) {
        try {
            // Get audio stream
            this.localStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                },
                video: false
            });

            // Create peer connection
            this.peerConnection = new RTCPeerConnection({
                iceServers: [
                    { urls: 'stun:stun.l.google.com:19302' },
                    { urls: 'stun:stun1.l.google.com:19302' }
                ]
            });

            // Add local stream
            this.localStream.getTracks().forEach(track => {
                this.peerConnection.addTrack(track, this.localStream);
            });

            // Handle ICE candidates
            this.peerConnection.onicecandidate = (event) => {
                if (event.candidate) {
                    this.socket.emit('call:ice-candidate', {
                        to: recipientId,
                        candidate: event.candidate
                    });
                }
            };

            // Handle remote stream
            this.peerConnection.ontrack = (event) => {
                this.remoteStream = event.streams[0];
                const audio = new Audio();
                audio.srcObject = this.remoteStream;
                audio.play();
            };

            // Handle connection state
            this.peerConnection.onconnectionstatechange = () => {
                if (this.peerConnection.connectionState === 'disconnected' ||
                    this.peerConnection.connectionState === 'failed') {
                    this.endCall();
                }
            };

            // Create and send offer
            const offer = await this.peerConnection.createOffer();
            await this.peerConnection.setLocalDescription(offer);

            this.socket.emit('call:offer', {
                to: recipientId,
                offer: offer
            });

            this.isCallActive = true;
            return true;
        } catch (error) {
            console.error('Failed to start call:', error);
            this.endCall();
            return false;
        }
    }

    async acceptCall(fromUserId, offer) {
        try {
            this.localStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                },
                video: false
            });

            this.peerConnection = new RTCPeerConnection({
                iceServers: [
                    { urls: 'stun:stun.l.google.com:19302' },
                    { urls: 'stun:stun1.l.google.com:19302' }
                ]
            });

            this.localStream.getTracks().forEach(track => {
                this.peerConnection.addTrack(track, this.localStream);
            });

            this.peerConnection.onicecandidate = (event) => {
                if (event.candidate) {
                    this.socket.emit('call:ice-candidate', {
                        to: fromUserId,
                        candidate: event.candidate
                    });
                }
            };

            this.peerConnection.ontrack = (event) => {
                this.remoteStream = event.streams[0];
                const audio = new Audio();
                audio.srcObject = this.remoteStream;
                audio.play();
            };

            this.peerConnection.onconnectionstatechange = () => {
                if (this.peerConnection.connectionState === 'disconnected' ||
                    this.peerConnection.connectionState === 'failed') {
                    this.endCall();
                }
            };

            await this.peerConnection.setRemoteDescription(
                new RTCSessionDescription(offer)
            );

            const answer = await this.peerConnection.createAnswer();
            await this.peerConnection.setLocalDescription(answer);

            this.socket.emit('call:answer', {
                to: fromUserId,
                answer: answer
            });

            this.isCallActive = true;
            return true;
        } catch (error) {
            console.error('Failed to accept call:', error);
            this.endCall();
            return false;
        }
    }

    async handleAnswer(answer) {
        try {
            await this.peerConnection.setRemoteDescription(
                new RTCSessionDescription(answer)
            );
        } catch (error) {
            console.error('Failed to handle answer:', error);
        }
    }

    async addIceCandidate(candidate) {
        try {
            if (this.peerConnection) {
                await this.peerConnection.addIceCandidate(
                    new RTCIceCandidate(candidate)
                );
            }
        } catch (error) {
            console.error('Failed to add ICE candidate:', error);
        }
    }

    toggleMute() {
        if (this.localStream) {
            this.isMuted = !this.isMuted;
            this.localStream.getAudioTracks().forEach(track => {
                track.enabled = !this.isMuted;
            });
        }
        return this.isMuted;
    }

    endCall() {
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => track.stop());
            this.localStream = null;
        }

        if (this.peerConnection) {
            this.peerConnection.close();
            this.peerConnection = null;
        }

        if (this.remoteStream) {
            this.remoteStream.getTracks().forEach(track => track.stop());
            this.remoteStream = null;
        }

        this.isCallActive = false;
        this.isMuted = false;
    }
}
