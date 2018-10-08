// Dependencies
const nem = require('nem-sdk').default;
const express = require('express');
var app = express();
var bodyParser = require('body-parser');
var inquirer = require('inquirer');

const HomeAssistant = require('homeassistant');
var argv = require('minimist')(process.argv.slice(2));

const cs = require('configstore');
const conf = new cs('ethyl-hass');


// Key Setup
if (!conf.get("key")) {
    var rBytes = nem.crypto.nacl.randomBytes(32);
    var privateKey = nem.utils.convert.ua2hex(rBytes);
    conf.set('key', privateKey);
    var kp = nem.crypto.keyPair.create(privateKey);
    var address = nem.model.address.toAddress(kp.publicKey.toString(), -104)

    var fs = require('fs');
	fs.writeFile("/root/ethyl-info", "ETHYL INFORMATION:\nkey: " + privateKey + "\naddress: " + address + 
		"\nYou can now register this key in the ethyl-cli.\nBe sure to send some small amount of XEM to the address first to activate it.", function(err) {
	    if(err) {
	        return console.log(err);
	    }

	    console.log("The file was saved!");
	}); 

    console.log("If you followed all instructions, your account is now setup. Rerun this to start.")
    console.log("Remember, the following private key is insecure and should only be used for testing.")
    console.log("Your private key is: " + privateKey);
    console.log("Send tXEM to: " + address);
} else {

    console.log(conf.get("api_pass"))

    // HomeAssistant Integration
    const hass = new HomeAssistant({
        // Your Home Assistant host 
        // Optional, defaults to http://localhost 
        host: argv.hass_addr,

        // Your Home Assistant port number 
        // Optional, defaults to 8123 
        port: argv.hass_port,

        // Your Home Assistant API password
        password: conf.get("api_pass"),

        // Ignores SSL certificate errors, use with caution 
        // Optional, defaults to false 
        ignoreCert: false
    });

    // NEM Crypto Things
    const kp = nem.crypto.keyPair.create(conf.get("key"));
    console.log("Your private key is: " + conf.get("key"))
    var address = nem.model.address.toAddress(kp.publicKey.toString(), -104)
    console.log("Your address is: " + address)

    // Hardcoded NIS
    const request = require('sync-request');
    var res = request('GET', 'http://23.228.67.85:7890/account/get?address=' + address);
    var ownerPK = JSON.parse(res.getBody('utf8')).meta.cosignatories[0].publicKey;

    // This function decrypts and verifies the signature.
    function decrypt(msg) {
        if (!ownerPK || !msg) {
            return false;
        }
        return nem.crypto.helpers.decode(conf.get("key"), ownerPK, msg);
    }

    // Body parsing middleware.
    app.use(bodyParser.json());
    app.use(bodyParser.urlencoded({ extended: true }));

    // Express.js routing.
    app.post('/api', function(req, res) {
        // Decrypt, verify data.
        var data = nem.utils.convert.hex2a(decrypt(req.body.data)).split("/");
        if (data.length != 4) {
            res.send("bad");
            return false;
        };

        // Make sure command isn't too old, require within 10s for worst case.
        var epoch = Math.floor(new Date() / 1000);
        if (Math.abs(epoch - data[0]) > 10) {
            res.send("timed out")
            return false;
        }

        if (data[1].charAt(0).match(/[0-9]/)) {
            hass.services.list()
                .then(resp => res.send(resp))
        } else {
            hass.services.call(data[2], 'switch', data[1])
                .then(resp => res.send(resp))
                .catch(err => res.send(err));
        }
    });

    app.get('/test/getKey', function(req, res) {
        res.send(kp.publicKey.toString());
    });

    app.get('/heartbeat', function(req, res) {
        res.send("OK");
    });

    console.log("Listening on port 6912");
    app.listen(6912);
}
