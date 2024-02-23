'use strict';
class MiiboAvatar {
    constructor(config) {
        this.container = config.container;
        this.speechToTextOptions = config.option.speech_to_text;
        this.miiboOptions = config.option.miibo;
        this.didOptions = config.option.d_id;
        this.initialize();
    }

    initialize() {
        const RTCPeerConnection = window.RTCPeerConnection || window.webkitRTCPeerConnection || window.mozRTCPeerConnection;

        this.videoElement = document.getElementById(this.container);
        this.videoElement.setAttribute('playsinline', '');
        this.playIdleVideo();

        this.createNewStream();
        this.rec = new webkitSpeechRecognition()
        this.transcripts = "";

        this.sentences = [];
        this.speech_cnt = 0;
        this.speaching = false;
        this.processing = false;
        this.streams = [];
    }

    async createNewStream() {
        try {
            this.stopAllStreams();
            this.closePC();

            let presenter = {"source_url": this.didOptions.presenter.image_url}
            const sessionResponse = await this.fetchWithRetries(`https://api.d-id.com/${this.didOptions.service}/streams`, {
                method: 'POST',
                headers: {
                    Authorization: `Basic ${this.didOptions.key}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(presenter),
            });

            const { id: newStreamId, offer, ice_servers: iceServers, session_id: newSessionId } = await sessionResponse.json();
            this.streamId = newStreamId;
            this.sessionId = newSessionId;

            try {
                this.sessionClientAnswer = await this.createPeerConnection(offer, iceServers);
            } catch (e) {
                console.log('Error creating peer connection:', e);
                this.stopAllStreams();
                this.closePC();
                return;
            }

            const sdpResponse = await fetch(`https://api.d-id.com/${this.didOptions.service}/streams/${this.streamId}/sdp`, {
                method: 'POST',
                headers: {
                    Authorization: `Basic ${this.didOptions.key}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    answer: this.sessionClientAnswer,
                    session_id: this.sessionId,
                }),
            });

            // Handle sdpResponse if needed
        } catch (error) {
            console.log('Error creating new stream:', error);
            // Handle error
        }
    }

    GoogleSpeechRecogInit() {
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)()

        if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
            navigator.mediaDevices.getUserMedia({audio: true}).then((stream) => {
                var input = this.audioContext.createMediaStreamSource(stream)
                this.audioContext.resume()
                this.recorder = new Recorder(input)
            })
        }
    }

    startRecording() {
        if (this.audioContext) {
            this.recorder && this.recorder.record();
        } else {
            this.rec.continuous = false;
            this.rec.interimResults = false;
            this.rec.lang = 'ja-JP';

            this.rec.onresult = (e) => {
                for (var i = e.resultIndex; i < e.results.length; i++) {
                    if (!e.results[i].isFinal) continue;

                    const { transcript } = e.results[i][0];
                    this.transcripts += transcript;
                }
            };
            this.rec.onend = () => {
                if (!this.processing) this.rec.start();
            }
            this.rec.start();
        }
    }

    stopRecording() {
        if (this.audioContext) {
            this.playLoadingVideo();
            this.recorder && this.recorder.stop();
            this.audioRecognize();
            this.recorder.clear();
        } else {
            this.rec.stop();
            this.processing = true;
            this.playLoadingVideo();

            this.ask(this.transcripts);
            this.transcripts = "";
        }
    }

    audioRecognize() {
        this.recorder && this.recorder.exportWAV((blob) => {
            let reader = new FileReader()
            reader.onload = () => {
                let result = new Uint8Array(reader.result)

                let data = {
                    "config": {
                        "encoding": "LINEAR16",
                        "languageCode": "ja-JP",
                        "alternativeLanguageCodes": ["en-US"],//,"cmn-CN","ko-KR"],
                        "audio_channel_count": 2
                    },
                    "audio": {
                        "content": this.arrayBufferToBase64(result)
                    }
                }
                fetch('https://speech.googleapis.com/v1/speech:recognize?key=' + this.speechToTextOptions.api_key, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json; charset=utf-8'
                    },
                    body: JSON.stringify(data)
                }).then((response) => {
                    return response.text()
                }).then((text) => {
                    let result_json = JSON.parse(text)
                    text = result_json.results[0].alternatives[0].transcript;
                    this.languageCode = result_json.results[0].languageCode;
                    this.ask(text)
                })
            }
            reader.readAsArrayBuffer(blob)
        })
    }

    // Chrome Only
    autoRecognize() {
        this.rec.continuous = false
        this.rec.interimResults = false
        this.rec.lang = 'ja-JP'

        this.rec.onresult = (e) => {
            this.processing = true
            this.playLoadingVideo();

            this.rec.stop()

            for (var i = e.resultIndex; i < e.results.length; i++) {
                if (!e.results[i].isFinal) continue

                const { transcript } = e.results[i][0]
                this.ask(transcript);
            }
        }

        this.rec.onend = () => { this.autoRecognizeRestart() }
        this.rec.start()
    }

    autoRecognizeRestart() {
        if (this.processing) {
            setTimeout(() => {this.autoRecognizeRestart()}, 1000)
        } else {
            this.rec.start()
        }
    }

    arrayBufferToBase64(buffer) {
        let binary = ''
        let bytes = new Uint8Array(buffer);
        let len = bytes.byteLength
        for (let i = 0; i < len; i++) {
            binary += String.fromCharCode(bytes[i])
        }
        return window.btoa(binary)
    }

    ask(message) {
        console.log(Recognize: message)
        this.getMiiboResponse(message);
    }

    async getMiiboResponse(utterance) {
        const params = {
            api_key: this.miiboOptions.api_key,
            agent_id: this.miiboOptions.agent_id,
            uid: this.miiboOptions.user_id,
            stream: true,
            utterance: utterance
        };

        try {
            const res = await fetch("https://api-mebo.dev/api", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(params),
            });

            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let output = "";
            let sentences = [];
            let current_index = 0;

            const read = async () => {
                const { done, value } = await reader.read();
                if (done) return;

                let dataString = decoder.decode(value).split("\n").filter(x => x != "");

                try {
                    let responseData = JSON.parse(dataString[dataString.length - 1]);

                    output = responseData.bestResponse.utterance.split("\n").filter(x => x.trim() != "").join("\n");
                    sentences = output.replaceAll(/[。\.\!\?！？]/g,".").split(".")
                    if (this.didOptions.priority == "speed" && current_index == 0 && current_index + 1 < sentences.length) {
                        this.startTalk(sentences[current_index++]);
                        this.speech_cnt++;
                    }
                } catch(e) {
                    console.log(e);
                }

                return read();
            };

            await read();
            reader.releaseLock();

            this.startTalk(sentences.slice(current_index).join("。"));
        } catch(error) {
            console.log("Error fetching AI response: ", error);
        }
    }

    async startTalk(input) {
        console.log("talk",input)
        if (this.peerConnection?.signalingState === 'stable' || this.peerConnection?.iceConnectionState === 'connected') {

            const gender = this.didOptions.presenter.gender;
            let voice_id = this.didOptions.presenter.voice_id || "";

            if (voice_id == "") {
                switch (this.languageCode) {
                    case "en-us":
                        voice_id = gender == "male" ? "en-US-GuyNeural" : "en-US-AriaNeural"
                        break;
                    case "ko-kr":
                        voice_id = gender == "male" ? "ko-KR-InJoonNeural" : "ko-KR-YuJinNeural"
                        break;
                    case "cmn-CN":
                        voice_id = gender == "male" ? "zh-CN-YunjianNeural" : "zh-CN-XiaohanNeural"
                        break;
                    default:
                        voice_id = gender == "male" ? "ja-JP-KeitaNeural" : "ja-JP-NanamiNeural"
                }
            }

            const requestOptions = {
                method: 'POST',
                headers: {
                    Authorization: `Basic ${this.didOptions.key}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    script: {
                        type: "text",
                        subtitles: false,
                        provider: {
                            type: "microsoft",
                            voice_id: voice_id
                        },
                        ssml: false,
                        input: input
                    },
                    config: {
                        fluent: false,
                        pad_audio: 0,
                        align_driver: false,
                        stitch: false,
                        auto_match: false,
                        sharpen: false,
                        normalization_factor: 0
                    },
                    session_id: this.sessionId,
                }),
            };

            if (this.didOptions.service === 'clips') {
                requestOptions.body.background = { color: '#FFFFFF' };
            }

            try {
                const playResponse = await this.fetchWithRetries(`https://api.d-id.com/${this.didOptions.service}/streams/${this.streamId}`, requestOptions);
                // Handle response if needed
            } catch (error) {
                console.error('Error starting talk:', error);
                // Handle error
            }
        }
    }

    async destoryTalk(input) {
        try {
            await fetch(`https://api.d-id.com/${this.didOptions.service}/streams/${this.streamId}`, {
                method: 'DELETE',
                headers: {
                    Authorization: `Basic ${this.didOptions.key}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ session_id: this.sessionId }),
            });

            await this.stopAllStreams();
            await this.closePC();
        } catch (error) {
            console.error('Error destroying talk:', error);
            // Handle error
        }
    }

    onIceCandidate(event) {
        if (event.candidate) {
            const { candidate, sdpMid, sdpMLineIndex } = event.candidate;

            fetch(`https://api.d-id.com/${this.didOptions.service}/streams/${this.streamId}/ice`, {
                method: 'POST',
                headers: {
                    Authorization: `Basic ${this.didOptions.key}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    candidate,
                    sdpMid,
                    sdpMLineIndex,
                    session_id: this.sessionId,
                }),
            }).catch((error) => {
                console.error('Error sending ICE candidate:', error);
                // Handle error
            });
        }
    }

    onIceConnectionStateChange() {
       if (this.peerConnection.iceConnectionState === 'failed' || this.peerConnection.iceConnectionState === 'closed') {
           this.stopAllStreams();
           this.closePC();
       }
    }

    onTrack(event) {
        if (!event.track || !event.streams || event.streams.length === 0) return;

        this.statsIntervalId = setInterval(async () => {
            const stats = await this.peerConnection.getStats(event.track);
            stats.forEach((report) => {
                if (report.type === 'inbound-rtp' && report.mediaType === 'video') {
                    const videoStatusChanged = this.videoIsPlaying !== report.bytesReceived > this.lastBytesReceived;

                    if (videoStatusChanged) {
                        this.videoIsPlaying = report.bytesReceived > this.lastBytesReceived;
                        this.onVideoStatusChange(this.videoIsPlaying, event.streams[0]);
                    }
                    this.lastBytesReceived = report.bytesReceived;
                }
            });
        }, 100);
    }

    onVideoStatusChange(videoIsPlaying, stream) {
        let status;
        if (videoIsPlaying) {
            status = 'streaming';
            const remoteStream = stream;
            this.streams.push(remoteStream);
            this.checkSpeaching();
        } else {
            status = 'empty';

            this.speaching = false;
            if (this.speech_cnt <= 0) {
                this.speech_cnt = 0;
                this.processing = false;
            } else {
                this.speech_cnt--;
            }
            this.playIdleVideo();
        }
    }

    checkSpeaching() {
        if (this.speaching) {
            setTimeout(() => {this.checkSpeaching()}, 20)
        } else {
            this.setVideoElement(this.streams.shift());
        }
    }

    async createPeerConnection(offer, iceServers) {
        if (!this.peerConnection) {
            this.peerConnection = new RTCPeerConnection({ iceServers });
            this.peerConnection.addEventListener('icecandidate', this.onIceCandidate.bind(this), true);
            this.peerConnection.addEventListener('iceconnectionstatechange', this.onIceConnectionStateChange.bind(this), true);
            this.peerConnection.addEventListener('track', this.onTrack.bind(this), true);
        }

        await this.peerConnection.setRemoteDescription(offer);
        const sessionClientAnswer = await this.peerConnection.createAnswer();
        await this.peerConnection.setLocalDescription(sessionClientAnswer);
        return sessionClientAnswer;
    }


    setVideoElement(stream) {
        if (!stream) return;
        this.videoElement.srcObject = stream;
        this.videoElement.loop = false;

        // safari hotfix
        if (this.videoElement.paused) {
            this.videoElement
                .play()
                .then((_) => {})
                .catch((e) => {});
        }
    }

    playIdleVideo() {
        this.videoElement.srcObject = undefined;
        this.videoElement.src = this.didOptions.presenter.idle_movie;
        this.videoElement.loop = true;
    }

    playLoadingVideo() {
        this.videoElement.srcObject = undefined;
        this.videoElement.src = this.didOptions.presenter.loading_movie;
        this.videoElement.loop = false;
    }

    stopAllStreams() {
        if (this.videoElement.srcObject) {
            this.videoElement.srcObject.getTracks().forEach((track) => track.stop());
            this.videoElement.srcObject = null;
        }
    }

    closePC(pc = this.peerConnection) {
        if (!pc) return;
        pc.close();
        pc.removeEventListener('icecandidate', this.onIceCandidate.bind(this), true);
        pc.removeEventListener('iceconnectionstatechange', this.onIceConnectionStateChange.bind(this), true);
        pc.removeEventListener('track', this.onTrack.bind(this), true);
        clearInterval(this.statsIntervalId);
        if (pc === this.peerConnection) {
            this.peerConnection = null;
        }
    }

    async fetchWithRetries(url, options, retries = 1) {
        const maxRetryCount = 3;
        const maxDelaySec = 4;
        try {
            return await fetch(url, options);
        } catch (err) {
            if (retries <= maxRetryCount) {
                const delay = Math.min(Math.pow(2, retries) / 4 + Math.random(), maxDelaySec) * 1000;
                await new Promise((resolve) => setTimeout(resolve, delay));
                return this.fetchWithRetries(url, options, retries + 1);
            } else {
                throw new Error(`Max retries exceeded. error: ${err}`);
            }
        }
    }
}
