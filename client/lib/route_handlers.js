'use strict';

var config = require('../config'),
    viewer = require('./viewer'),
    exec = require('child_process').exec,
    fs= require('fs'),
    rest= require('./restware'),
    path = require('path'),
    _= require('underscore'),
    jade = require('jade'),
    os = require('os');


var rhGlobals = {
        playlistOn:         false,
        currentPlaylist:    null,
        playlistStarttime:  null,
        diskSpaceUsed:      null,
        diskSpaceAvailable: null,
        lastUpload:         null,
        duration:           null,
        tvStatus:           true
    },
    settings = {
        name:           "piSignage",
        note:           "Add a small optional note here",
        cpuSerialNumber: "",
        myIpAddress: ""
    };

var validFile = function(file){
    return (file.charAt(0) != '_' && file.charAt(0) != '.');
}
var writeToConfig= function(){
    fs.writeFile(config.poweronConfig, JSON.stringify(rhGlobals, null, 4), function(err){
        if (err) throw err;
    })
}
var getMediaPath= function(file){
    return config.mediaPath + file;
}
var extHtmlJson= function(file){
    return '_'+path.basename(file,'.html')+'.json';
}
var isExtHtml= function(file){
    return path.extname(file) == '.html'
}

var updateDiskStatus = function () {
    exec('df -h /').stdout.on('data',function(data){
        //console.log("the total usage" +data);
        var strings = data.replace(/\s{2,}/g, ' ').split(" ");
        rhGlobals.diskSpaceUsed = strings[strings.length-2];
        rhGlobals.diskSpaceAvailable = strings[strings.length-3];
    })
}

exports.mediaList = function(req,res){

    fs.readdir(config.mediaDir,function (err, data) {
        if (err){
            return rest.sendError(res, "Error reading media directory: "+err)
        } else {
            var files = data.filter(validFile),
                requestedplaylist= getMediaPath(req.query['withplaylist']) || config.defaultPlaylist;
            if (requestedplaylist && fs.existsSync(requestedplaylist)) {
                fs.readFile(requestedplaylist, 'utf8', function (err, data) {
                    
                    var assets= (data.length)? (JSON.parse(data).assets)? JSON.parse(data).assets: null: null,
                        plitems = (data.length)? assets: null,
                        plfiles = [];
                        
                    if (err || !plitems || files.length == 0){
                        return rest.sendSuccess(res, "Could not read playlist: "+err,files)
                    } else {                       
                        for (var key in plitems) {
                            plfiles.push(plitems[key].filename);
                        }
                        
                        for (var i= 0,len=files.length;i<len;i++) {
                            if (plfiles.indexOf(files[i]) == -1) {
                                plitems.push({filename: files[i], duration: 10, selected: false});
                            }
                        }
                        
                        for (var i= 0,len=plitems.length;i<len;i++) {
                            if ((files.indexOf(plitems[i].filename) == -1) && (plitems[i].selected)) {
                                plitems[i].deleted = true;
                            }
                        }
                    return rest.sendSuccess(res, "Sending loaded Playlist: ",plitems);
                    }
                })
            } else {
                return rest.sendSuccess(res, "Sending media directory files: ",files)
            }

        }
    });
}

exports.playFile = function(req,res){
    if (req.body.play) {
        var err;
        if (req.params['playfile']) {
            err = viewer.startPlay({filename: req.params['playfile'],duration:100000});
        } else {
            err = "Nothing to Play";
        }

        if (err) {
            return rest.sendError(res,err);
        } else {
            return rest.sendSuccess(res,'Started playing file',rhGlobals);
        }
    }

    if (req.body.stop) {
        var err = viewer.stopPlay();
        rest.sendSuccess(res,'Stopped playing file',rhGlobals);
        return;
    }
}

exports.fileUpload = function(req, res){    
    var alldata=[], len=Object.keys(req.files).length;
    var origName= function(media, mediapath){
        fs.exists(mediapath, function (exists) {
            if(exists){
                var data= {
                    overwritten: true,
                    name: media.name
                }
                alldata.push(data);
            }else{
                var data= {
                    name: media.name,
                    path: media.path,
                    size: media.size,
                    type: media.type
                }
                alldata.push(data);
            }
            len--;
            if(!len) {
                rhGlobals.lastUpload = Date.now();
                writeToConfig();
                updateDiskStatus();
                rest.sendSuccess(res, "Uploaded files", alldata);
            }            
        });
        fs.rename(media.path, mediapath, function(err){
            if(err) console.log(err);
        });       
    }
    for(var key in req.files) {
        var media= req.files[key],
            mediapath= getMediaPath(media.name);
        origName(media, mediapath);        
    }
}

exports.fileDetails = function(req, res){
    var file= req.param('file');    
    if(isExtHtml(file)){
        fs.readFile(getMediaPath(extHtmlJson(file)), 'utf8', function (err, data) {
            if (err) console.log(err);
            rest.sendSuccess(res, 'html file detail', (data.length)? JSON.parse(data): null);
        });
    }else{
        if (file != 'new') {               
            var stats= fs.statSync(getMediaPath(file)),
            data= {
                name: file,
                size: ~~(stats.size/1000)+' KB',
                extension: ext
            };
            rest.sendSuccess(res, '', data);
        }        
    }
}
exports.fileDelete = function(req, res){
    var file= req.param('file'),
        filejson= null;
    if (isExtHtml(file)) {
        filejson= getMediaPath(extHtmlJson(file));
    }
    if (file) {
        fs.unlink(getMediaPath(file), function(err){
            updateDiskStatus();
            if(err) {
                rest.sendError(res, "Unable to delete file!");
            }else{
            rest.sendSuccess(res, "File Deleted");
                if (filejson) {
                    fs.unlink(filejson, function(err){
                        if(err) console.log(err);
                   });                            
                }
            }
        })        
    }else{
        rest.sendError(res, "No file received");
    }
}

exports.fileRename = function(req, res){    
    var newname= req.param('file'),
        oldname= req.body.oldname;
    if (newname) {  
        fs.rename(getMediaPath(oldname), getMediaPath(newname), function (err) {
            if(err){
                rest.sendError(res, 'Unable to rename file!')
            }else{
                rest.sendSuccess(res, 'File Renamed!');
                if(isExtHtml(newname)){
                    fs.rename(getMediaPath(extHtmlJson(oldname)), getMediaPath(extHtmlJson(newname)), function (err) {
                        if(err) console.log(err);
                    });
                }                
            }
        });
        fs.readFile(config.defaultPlaylist, 'utf8', function (err, data) {
            if (err) console.log(err);
            if(data.indexOf(oldname) != -1){
                var write=  data.replace(oldname, newname);
                fs.writeFile(config.defaultPlaylist, write, function (err) {
                    if (err) console.log(err);
                });
            }
        }); 
    }
    else{
        rest.sendError(res, "No file name received");
    }
}

exports.createPlaylist= function(req, res){
    var file= getMediaPath(req.params['file']);
    fs.writeFile(file, '', function (err) {
        if(err) {
            console.log(err);
            rest.sendError(res, "File "+req.params['file']+" Not Created");
        }
        else {
            rest.sendSuccess(res, "File Created: "+req.params['file']);
        }
    });
}
exports.savePlaylist= function(req, res){
    var file= getMediaPath(req.body.file);
    fs.readFile(file, 'utf8', function (err, data) {
        if (err) {
            console.log(err);
        }
        else {
            var readdata= (data.length)? JSON.parse(data): null,
                template={
                    settings: (req.body.settings)? req.body.settings: (readdata)? readdata.settings: null,
                    assets: (req.body.assets)? req.body.assets: (readdata)? readdata.assets: null,
                };
            fs.writeFile(file,
                JSON.stringify(template, null, 4),
                function(err) {
                    (err)? rest.sendError(res, err): rest.sendSuccess(res, 'Saved to playlist');
                }
            );           
        }
    });        
}
exports.getPlaylist= function(req, res){
    var file= getMediaPath(req.params['file']);
    fs.readFile(file, 'utf8', function (err, data) {
        if (err) console.log(err);
        else {
            (data.length)
                ? rest.sendSuccess(res, 'Contents for playlist: '+ file, JSON.parse(data).settings)
                : rest.sendError(res, 'Contents for playlist: '+ file, 'empty')
        }
    });   
}

exports.getPlaylistFiles= function(req, res){
    var playlistfiles= [];
    fs.readdir(config.mediaPath, function(err, files){
        if(err) {
            console.log(err);
        }
        else{
            files.forEach(function(itm){
                var filename= path.basename(itm,'.json');
                if(itm.match(/^\_\_[^\_][ \S]*/)) {
                    var playlistdta= fs.readFileSync(getMediaPath(itm), 'utf8'),
                        settings;
                        settings= (playlistdta)? JSON.parse(playlistdta).settings: null;
                    playlistfiles.push({filename: filename.slice(2), settings: settings});
                }
            });
            rest.sendSuccess(res, 'All Playlist Files', playlistfiles);
        }        
    }); 
}

exports.noticeSave = function(req, res){    
    var data= req.body.formdata,
        template= fs.readFileSync(config.defaultTemplate,'utf8');
        
    var options= {
        filename: 'noticecss.css',
        pretty: true,
        compileDebug: false
    }
    var fn= jade.compile(template, options),
        varobj= {
            title: data.title,
            description: data.description,
            image: data.image,
            footer: data.footer
        };
    var html= fn(varobj);
    var noticejson= {
        filename: data.filename,
        title: data.title,
        description: data.description,
        image: data.image || '',
        footer: data.footer || ''
    };

    fs.writeFile(getMediaPath(data.filename+'.html'), html, 'utf8', function(err){
        if(err){
            rest.sendError(res, err)
        }else{
            rhGlobals.lastUpload = Date.now();
            writeToConfig();
            updateDiskStatus();
            rest.sendSuccess(res, 'Notice File Saved', { file: data.filename+'.html' });
            fs.writeFile(getMediaPath("_"+data.filename+'.json'),
                JSON.stringify(noticejson, null, 4), 'utf8', function(err){
                    if (err) {
                        console.log(err);
                    }
                });
        }
    });
}

exports.playPlaylist = function (req,res){

    if (req.body.play) {
        if (rhGlobals.playlistOn )
            return rest.sendError(res,"Already playing started");

        rhGlobals.playlistOn = true;
        if (req.params['playlist'] != 'default') {
            rhGlobals.currentPlaylist = getMediaPath(req.params['playlist']);
        } else {
            rhGlobals.currentPlaylist = config.defaultPlaylist;
        }
        try {
            var files = JSON.parse(fs.readFileSync(rhGlobals.currentPlaylist,'utf8')).assets;
        } catch (e) {
            return rest.sendError(res,"There seems to be no such playlist file: "+rhGlobals.currentPlaylist+";error="+ e.code);
        }

        var err = viewer.startPlay(files);
        if (err) {
            rhGlobals.playlistOn = false;
            return rest.sendError(res,err);
        } else {
            rhGlobals.playlistStarttime = Date.now();
            writeToConfig();
            rhGlobals.duration = 0;
            return rest.sendSuccess(res,'Started playlist',rhGlobals);
        }        
    }

    if (req.body.stop ) {
        if (!rhGlobals.playlistOn )
            return rest.sendError(res,"Already playing stopped");

        rhGlobals.playlistOn = false;
        var err = viewer.stopPlay();
        rhGlobals.playlistStarttime = null;
        rhGlobals.duration = Date.now() - rhGlobals.playlistStarttime;;
        rest.sendSuccess(res,'Stopped playlist',rhGlobals);
        rhGlobals.currentPlaylist = null;
        writeToConfig();
        return;
    }
}

exports.getStatus = function(req, res){
    rhGlobals.duration = Date.now() - rhGlobals.playlistStarttime;
    return rest.sendSuccess(res, 'Status Check', rhGlobals);
}


exports.getSettings = function(req, res){
    return rest.sendSuccess(res, 'Settings', {name: settings.name,note:settings.note});
}

exports.saveSettings =  function(req, res){
    settings.name = req.body.name;
    settings.note = req.body.note;
    fs.writeFile(config.settingsFile,
        JSON.stringify(settings, null, 4),
        function(err) {
            (err)? rest.sendError(res, err): rest.sendSuccess(res, "Settings Saved",{name: settings.name,note:settings.note});
        }
    );
}

updateDiskStatus();
//read the last config on poweron and start play if necessary
fs.readFile ( config.poweronConfig,'utf8', function(err,data){
    if (!err) {
        try {
            var cfgdata = JSON.parse(data);
        } catch(e) {
            fs.unlink(config.poweronConfig);    //corrupt file
        }
        if (cfgdata) {
            rhGlobals = cfgdata;
            if (rhGlobals.playlistOn) {

                var content = fs.readFileSync(rhGlobals.currentPlaylist,'utf8');
                if (!content) {
                    displayHelpScreen();
                } else {
                    var files = JSON.parse(content).assets;

                    var err = viewer.startPlay(files);
                    if (err) {
                        rhGlobals.playlistOn = false;
                        rhGlobals.playlistStarttime = null;
                        rhGlobals.currentPlaylist = null;
                    } else {
                        rhGlobals.playlistStarttime = Date.now();
                    }
                }
            } else {
                rhGlobals.playlistStarttime = null;
                displayHelpScreen();              
            }
        }
    } else {
        console.log("there seems to be no _config.json file: "+err);
        displayHelpScreen();
    }
    sendSocketIoStatus();
});


function displayHelpScreen(){
    var ipdata= os.networkInterfaces(), ipaddress, html;
    for(var key in ipdata){
        var interfaces= ipdata[key];
        for(var key in interfaces){
            var target= interfaces[key];
            if(target.family == 'IPv4' && !target.internal) ipaddress= target.address;
        }
    }                
    html= jade.compile(fs.readFileSync('./views/emptynotice.jade','utf8'))({ ipaddress: ipaddress || null});
    fs.writeFile('./media/_emptynotice.html', html, function(err){
        if (err) console.log(err);
        viewer.startPlay([{filename: '_emptynotice.html',duration:100000}]);
    })  
}

//Server communication
fs.readFile ( config.settingsFile,'utf8', function(err,data) {
    if (!err) {
        try {
            settings = JSON.parse(data);
        } catch (e) {
            //corrupt file
        }
    }
    //Socket.io based server communication
    exec("cat /proc/cpuinfo |grep Serial|awk '{print $3 }'").stdout.on('data',function(data){
        console.log("cpu serial number: " +data);
        settings.cpuSerialNumber = data;
    })
    var ipdata= os.networkInterfaces(), ipaddress;
    for(var key in ipdata){
        var interfaces= ipdata[key];
        for(var key in interfaces){
            var target= interfaces[key];
            if(target.family == 'IPv4' && !target.internal)
                settings.myIpAddress = target.address;
        }
    }
})

var io = require('socket.io-client'),
    socket = io.connect(config.server);              //add server address

socket.on('connect', function () {
    // socket connected
    console.log("socket.io: connected to server");
    sendSocketIoStatus();
    socket.on('status', function () {
        // socket connected
        sendSocketIoStatus();
    });
});

setInterval(function(){
    if (socket)
        sendSocketIoStatus();
    else
        socket = io.connect(config.server);
},5 * 60 * 1000)


function sendSocketIoStatus () {
    if (!socket)
        return;
    rhGlobals.duration = Date.now() - rhGlobals.playlistStarttime;
    socket.emit('status', settings, rhGlobals);
}




