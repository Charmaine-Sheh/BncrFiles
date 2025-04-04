/**
 * @author Merrick
 * @name wxWork
 * @version 1.0.4
 * @description 企业微信适配器
 * @team Merrick
 * @adapter true
 * @public true
 * @disable false
 * @priority 2
 * @classification ["适配器"]
 * @Copyright ©2023 Merrick. All rights reserved
 */

/* 
v1.0.1 修复bug，适配无界2.0 WEB界面，增加markdown、voice格式支持，在部分节点增加log输出，方便排查
v1.0.2 适配3.0
v1.0.3 菜单点击事件支持，先在“企业微信-机器人-应用管理-自定义菜单”定义好菜单，对话窗口点击根据提示填写相关配置；支持图文同时发送
v1.0.4 修复菜单点击事件
*/


/* 配置构造器 */
const jsonSchema = BncrCreateSchema.object({
  enable: BncrCreateSchema.boolean().setTitle('是否开启适配器').setDescription(`设置为关则不加载该适配器`).setDefault(false),
  corpId: BncrCreateSchema.string().setTitle('corpId').setDescription(`请填入“我的企业-企业信息”页面获取的企业ID`).setDefault(''),
  corpSecret: BncrCreateSchema.string().setTitle('Secret').setDescription(`请填入“自建应用”页面获取的Secret`).setDefault(''),
  encodingAESKey: BncrCreateSchema.string().setTitle('encodingAESKey').setDescription(`请填入“自建应用-接收消息服务器配置”页面获取的的encodingAESKey`).setDefault(''),
  event: BncrCreateSchema.array(BncrCreateSchema.object({
    enable: BncrCreateSchema.boolean().setTitle('启用').setDescription('是否启用').setDefault(true),
    rule: BncrCreateSchema.object({
      eventkey: BncrCreateSchema.string().setTitle('事件代码').setDescription(`输入管理员点击菜单按钮后返回事件代码`).setDefault(''),
      msgkey: BncrCreateSchema.string().setTitle('触发词').setDescription(`输入该事件代码对应的插件触发词`).setDefault(''),
    }),
  })).setTitle('菜单事件').setDefault([])
});
/* 配置管理器 */
const ConfigDB = new BncrPluginConfig(jsonSchema);
const got = require('got');
const { decrypt } = require('@wecom/crypto');
const xmlParse = require('xml2js').parseString;
const FormData = require('form-data');
const xmlparser = require('express-xml-bodyparser');

module.exports = async () => {
  /* 读取用户配置 */
  await ConfigDB.get();
  /* 如果用户未配置,userConfig则为空对象{} */
  if (!Object.keys(ConfigDB.userConfig).length) return sysMethod.startOutLogs('未配置wxWork适配器，退出');
  if (!ConfigDB.userConfig.enable) return sysMethod.startOutLogs('未启用wxWork适配器，退出');
  const encodingAESKey = ConfigDB.userConfig.encodingAESKey;
  if (!encodingAESKey) return console.log('未设置encodingAESKey');
  const corpId = ConfigDB.userConfig.corpId;
  if (!corpId) return console.log('未设置corpId');
  const corpSecret = ConfigDB.userConfig.corpSecret;
  if (!corpSecret) return console.log('未设置Secret');
  //这里new的名字将来会作为 sender.getFrom() 的返回值
  const wxWork = new Adapter('wxWork');
  const wxDB = new BncrDB('wxWork');
  let botId = await wxDB.get('wxWorkBotId', ''); //自动设置，无需更改
  agentId = await wxDB.get('wxWorkAgentId', '');

  /**向/api/系统路由中添加路由 */
  router.use(xmlparser());
  router.get('/api/bot/wxWork', (req, res) => {
    try {
      const params = req.query;
      const { message } = decrypt(encodingAESKey, params.echostr);
      return res.send(message);
    } catch (e) {
      console.error('对接模块出错', e);
      res.send({ msg: '这是Bncr wxWork Api接口，你的get请求测试正常~，请用post交互数据' });
    }
  });

  router.post('/api/bot/wxWork', async (req, res) => {
    try {
      const body = req.body.xml,
        botID = body.tousername[0],
        xmlMsg = decrypt(encodingAESKey, body.encrypt[0]);
      let msgJson = {};
      xmlParse(xmlMsg.message, function (err, result) {
        msgJson = result.xml;
      });
      // console.log(msgJson);
      // console.log(msgJson['MsgType']);
      var msgContent, msgId, msgType, usrId, agentID;
      var msgType = msgJson['MsgType'][0];
      if (msgType !== 'text') {
        if (msgType === 'event') {
          var {
            EventKey: [msgContent],
            Event: [msgId],
            MsgType: [msgType],
            FromUserName: [usrId],
            AgentID: [agentID]
          } = msgJson;
          const events = ConfigDB.userConfig.event?.filter(o => o.enable) || [];
          const eventkeyinfos = events.map(v => { return v.rule.eventkey }) || [];
          // console.log(eventkeyinfos);
          let msgContents = [];
          if (msgContent) {
            msgContents = msgContent.split('#');
            if (msgContents.length = 4) {
              msgContent = msgContents.slice(0, -1).join('#');
              msgId = msgId + '_' + msgContents[3];
            }
          }
          // console.log(msgContent);
          if (eventkeyinfos.indexOf(msgContent) != -1) {
            for (const eventinfo of events) {
              const eventkey = eventinfo.rule.eventkey;
              const msgkey = eventinfo.rule.msgkey;
              if (eventkey && msgkey) {
                if (eventkey === msgContent) {
                  var msgType = 'text';
                  var msgContent = msgkey;
                }
              }
            }
          } else {
            const admininfo = await wxDB.get('admin', '');
            let admins = '';
            if (admininfo) {
              admins = admininfo.split('&');
            }
            // console.log(admins);
            if (admins) {
              if (admins.indexOf(usrId) != -1) {
                sysMethod.pushAdmin({
                  platform: ['wxWork'],
                  msg: `wxWork提示：该菜单事件代码[${msgContent}]未关联配置，请到web页面插件配置完成配置`,
                });
              }
            }
            res.send('');
            return;
          }
        } else {
          res.send('');
          return;
        }
      } else {
        var {
          Content: [msgContent],
          MsgId: [msgId],
          MsgType: [msgType],
          FromUserName: [usrId],
          AgentID: [agentID]
        } = msgJson;
      }
      if (botId !== botID) await wxDB.set('wxWorkBotId', botID);
      if (agentId !== agentID) await wxDB.set('wxWorkAgentId', agentID);
      // console.log(`收到 ${usrId} 发送的企业微信消息 ${msgJson['Content']}`);
      let msgInfo;
      if (msgType === 'text') {
        msgInfo = {
          userId: usrId || '',
          userName: '',
          groupId: '0',
          groupName: '',
          msg: msgContent || '',
          msgId: msgId || '',
          fromType: `Social`,
        };
      }
      msgInfo && wxWork.receive(msgInfo);
      res.send('');
    } catch (e) {
      console.error('接收消息模块出错', e);
      console.error('接收消息模块出错的msgJson', msgJson);
      res.send('');
    }
  });

  wxWork.reply = async function (replyInfo) {
    try {
      let body, mediaId, bodytxt;
      const toUser = replyInfo.userId;
      agentId = await wxDB.get('wxWorkAgentId', '');
      // console.log(replyInfo);
      switch (replyInfo.type) {
        case 'text':
          replyInfo.msg = replyInfo.msg.replace(/\n/g, '\r');
          body = {
            "touser": toUser,
            "msgtype": "text",
            "agentid": agentId,
            "text": {
              "content": replyInfo.msg
            }
          };
          break;
        case 'markdown':
          body = {
            "touser": toUser,
            "msgtype": "markdown",
            "agentid": agentId,
            "markdown": {
              "content": replyInfo.msg
            }
          };
          break;
        case 'image':
          mediaId = await getMediaID(replyInfo.path, 'image');
          body = {
            "touser": toUser,
            "msgtype": "image",
            "agentid": agentId,
            "image": {
              "media_id": mediaId
            }
          };
          break;
        case 'video':
          mediaId = await getMediaID(replyInfo.path, 'video');
          body = {
            "touser": toUser,
            "msgtype": "video",
            "agentid": agentId,
            "video": {
              "media_id": mediaId
            }
          };
          break;
        case 'voice':
          mediaId = await getMediaID(replyInfo.path, 'voice');
          body = {
            "touser": toUser,
            "msgtype": "voice",
            "agentid": agentId,
            "voice": {
              "media_id": mediaId
            }
          };
          break;
        default:
          return;
      }
      if (replyInfo.type !== 'text' && replyInfo.type !== 'markdown') {
        if (replyInfo.msg) {
          bodytxt = {
            "touser": toUser,
            "msgtype": "text",
            "agentid": agentId,
            "text": {
              "content": replyInfo.msg
            }
          };
        }
      }
      if (body) {
        let msgId = await sendMsg(body);
        let msgIds = [];
        if (bodytxt) {
          msgIds.push(msgId);
          msgIds.push(await sendMsg(bodytxt));
        }
        // console.log('返回的msgid', msgId);
        if (msgIds.length) {
          return msgIds;
        } else {
          return msgId;
        }
      }
    } catch (e) {
      console.error('回复消息模块出错', e);
      res.send('');
    }
  }

  /* 推送消息方法 */
  wxWork.push = async function (replyInfo) {
    return this.reply(replyInfo);
  }

  wxWork.delMsg = async function (msgId) {
    const accessToken = await getAccessToken();
    try {
      const url = `https://qyapi.weixin.qq.com/cgi-bin/message/recall?access_token=${accessToken}`;
      const body = { "msgid": msgId[1] };
      if (msgId) await got.post({ url, json: body });
      return true;
    } catch (e) {
      console.error('撤回消息模块出错', e);
      return false;
    }
  }

  return wxWork;

  async function sendMsg(body) {
    const accessToken = await getAccessToken();
    try {
      const url = `https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${accessToken}`;
      const resJson = await got.post({ url, json: body }).json();
      if (resJson['errcode'] === 0) {
        return resJson.msgid;
      } else {
        console.log(`发送消息函数出错`, JSON.stringify(resJson));
      }
    } catch (e) {
      console.error(`发送消息函数出错`, e);
    }
  }

  async function getMediaID(mediaPath, mediaType) {
    try {
      // 获取Token生成上传url
      const accessToken = await getAccessToken();
      const url = `https://qyapi.weixin.qq.com/cgi-bin/media/upload?access_token=${accessToken}&type=${mediaType}`;
      // 获取网络图片文件流并上传到微信服务器
      const response = await got.get(mediaPath, { responseType: 'buffer' });
      const form = new FormData();
      form.append('media', response.body, { filename: 'media' }); // 设置文件名
      const formData = form.getBuffer(); // 获取表单数据
      const formHeaders = form.getHeaders(); // 获取表单头部
      const options = {
        body: formData,
        headers: {
          ...formHeaders,
          'Content-Length': formData.length // 必须设置 Content-Length
        },
        responseType: 'json' // 响应类型为 JSON
      };
      const resJson = await got.post(url, options);
      if (resJson.body.media_id) {
        return resJson.body.media_id;
      } else {
        console.log(`上传文件函数出错`, JSON.stringify(resJson.body));
      }
    } catch (e) {
      console.error(`上传文件函数出错`, e);
    }
  }

  async function getAccessToken() {
    const wxTokenExp = await wxDB.get('wxTokenExp', '');
    if (!wxTokenExp || wxTokenExp < Date.now()) {
      const url = `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${corpId}&corpsecret=${corpSecret}`;
      try {
        const tkJson = await got.get(url).json();
        if (tkJson['access_token']) {
          const expTime = Date.now() + (1.5 * 60 * 60 * 1000);
          await wxDB.set('wxWorkToken', tkJson['access_token']);
          await wxDB.set('wxTokenExp', expTime);
          return tkJson.access_token;
        } else {
          console.log(`获取Token函数出错`, JSON.stringify(tkJson));
        }
      } catch (e) {
        console.error(`获取Token函数出错`, e);
      }
    } else {
      const accessToken = await wxDB.get('wxWorkToken', '');
      return accessToken
    }
  }
}
