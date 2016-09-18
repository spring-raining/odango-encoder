'use strict';

const fs = require('fs');
const path = require('path');
const util = require('util');
const child_process = require('child_process');

const parse = require('co-body');
const dateFormat = require('dateformat');
const koa = require('koa');
const route = require('koa-route');
const mkdirp = require('mkdirp');
const opts = require('opts');

opts.parse([
  {
    short       : 'p',
    long         : 'port',
    description : 'ポート',
    value       : true,
    required    : false,
  }, {
    short       : 'ffmpeg',
    long        : 'ffmpeg',
    description : 'ffmpegパス',
    value       : true,
    required    : false,
  },
], true);

const app = koa();
const port = opts.get('port') || 6000;

// curl -XPOST localhost:6000 -d '{"input": "/home/video/hoge.ts", "outputDir": "/tmp/output", "programData": { ... }}'
app.use(route.post('/', function* () {
  const body = yield parse.json(this);
  if (!body.input || !body.outputDir) {
    this.body = 'Invalid JSON';
    this.status = 400;
    return this;
  }

  const inputPath = path.resolve(body.input);
  if (!fs.existsSync(inputPath)) {
    this.body = 'Input file not found'
    this.status = 400;
    return this;
  }

  encode(inputPath, body.outputDir, body.programData);
  this.body = 'ok';
}));

app.listen(port);

/**
 * encode TS file
 */
function encode(input, outputDir, programData = null) {
  return new Promise((resolve, reject) => {
    var printf02d = (num) => {
      return (num < 10)? '0' + num : '' + num;
    };
    var formatToHMS = (ms) => {
      var h = String(Math.floor(ms / 3600000) + 100).substring(1);
      var m = String(Math.floor((ms - h * 3600000)/60000)+ 100).substring(1);
      var s = String(Math.round((ms - h * 3600000 - m * 60000)/1000)+ 100).substring(1);
      return h+':'+m+':'+s;
    };

    const ffmpeg = opts.get('ffmpeg') || 'ffmpeg';
    const encodeStart = Date.now();
    let destDir;
    let destName;

    util.log("encode start: " + input);

    if (programData
    &&  programData.title
    &&  programData.fullTitle
    &&  programData.start) {
      destDir = path.resolve(outputDir, programData.title);
      destName = dateFormat(new Date(programData.start), 'yyyymmdd-HHMM')
              + '-' + programData.title
              + ((programData.episode !== null)? '-' + printf02d(programData.episode) : '')
              + '.mp4';

      util.log('\tprogram title: ' + JSON.stringify(programData));
    }
    else {
      var programTitle = path.basename(input).replace(/\..*$/, '');
      destDir = path.resolve(outputDir, programTitle);
      destName = programTitle + '.mp4';
    }

    mkdirp.sync(destDir);

    child_process.exec(
      ffmpeg + ' -y -i "' + input + '"'
            + ' -loglevel error'
            + ' -threads 0'                 // マルチスレッド化
            + ' -f mp4'                     // 出力コンテナ
            + ' -c:v libx264'               // 映像コーデック
            + ' -c:a libfdk_aac'            // 音声コーデック
            + ' -b:v 1536k'                 // 映像ビットレート
            + ' -b:a 192k'                  // 音声ビットレート
            + ' -r 30000/1001'              // フレームレート (30000/1001 = 29.97fps)
            + ' -aspect 16:9'               // アスペクト比
            + ' -s 1280x720'                // 映像サイズ
            + ' -flags +loop'               // +loop ブロックフィルタ有効化
            + ' -filter:v yadif'            // インターレース解除
            + ' -pass 1'                    // 1パスエンコード
            + ' -level 31'                  // x264レベル (1920x1080では41に)
            + ' -refs 6'                    // 動き予測用フレーム参照数
            + ' -bf 3'                      // 最大連続Bフレーム数
            + ' -ar 48000'                  // 音声サンプリングレート
            + ' "' + path.resolve(destDir, destName) + '"',
      { maxBuffer: 1024 * 1024 },
      function(err, stdout, stderr) {
        const encodeTime = Date.now() - encodeStart;
        if (err) {
          util.log(stderr);
          util.log('encode failed');
          util.log('\ttime: ' + formatToHMS(encodeTime));
          reject(err);
        } else {
          util.log('encode finished: ' + path.resolve(destDir, destName));
          util.log('\ttime: ' + formatToHMS(encodeTime));
          resolve(path.resolve(destDir, destName))
        }
      }
    );
  });
}
