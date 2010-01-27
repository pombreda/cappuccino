
var FILE = require("file"),
    OS = require("os"),
    objj = require("objective-j"),
    ObjectiveJ = require("objective-j/core");

require("objective-j/rhino/regexp-rhino-patch");

var OBJJ_PREPROCESSOR_DEBUG_SYMBOLS   = exports.OBJJ_PREPROCESSOR_DEBUG_SYMBOLS   = ObjectiveJ.OBJJ_PREPROCESSOR_DEBUG_SYMBOLS;
var OBJJ_PREPROCESSOR_TYPE_SIGNATURES = exports.OBJJ_PREPROCESSOR_TYPE_SIGNATURES = ObjectiveJ.OBJJ_PREPROCESSOR_TYPE_SIGNATURES;
var OBJJ_PREPROCESSOR_PREPROCESS      = exports.OBJJ_PREPROCESSOR_PREPROCESS      = 1 << 10;
var OBJJ_PREPROCESSOR_COMPRESS        = exports.OBJJ_PREPROCESSOR_COMPRESS        = 1 << 11;
var OBJJ_PREPROCESSOR_SYNTAX          = exports.OBJJ_PREPROCESSOR_SYNTAX          = 1 << 12;

var SHRINKSAFE_PATH = FILE.join(objj.OBJJ_HOME, "shrinksafe", "shrinksafe.jar"),
    RHINO_PATH = FILE.join(objj.OBJJ_HOME, "shrinksafe", "js.jar")

var compressor = null;

function sharedCompressor()
{
    if (!compressor)
        compressor = OS.popen("java -server -Dfile.encoding=UTF-8 -classpath " + RHINO_PATH + ":" +  SHRINKSAFE_PATH + " org.dojotoolkit.shrinksafe.Main", { charset:"UTF-8" });

    return compressor;
}

function compress(/*String*/ aCode, /*String*/ FIXME)
{
    var tmpFile = FILE.join("/tmp", FIXME + Math.random() + ".tmp");

    FILE.write(tmpFile, aCode, { charset:"UTF-8" });

    var compressor = sharedCompressor();
        output = "",
        chunk = "";

    compressor.stdin.write(tmpFile + "\n");
    compressor.stdin.flush();

    while ((chunk = compressor.stdout.readLine()) !== "/*----*/\n")
        output += chunk;

    return output;
//    return OS.command(["java", "-Dfile.encoding=UTF-8", "-classpath", [RHINO_PATH, SHRINKSAFE_PATH].join(":"), "org.dojotoolkit.shrinksafe.Main", tmpFile]);
}

function compileWithResolvedFlags(aFilePath, objjcFlags, gccFlags)
{
    var shouldObjjPreprocess = objjcFlags & OBJJ_PREPROCESSOR_PREPROCESS,
        shouldCheckSyntax = objjcFlags & OBJJ_PREPROCESSOR_SYNTAX,
        shouldCompress = objjcFlags & OBJJ_PREPROCESSOR_COMPRESS,
        fileContents = "";

    if (OS.popen("which gcc").stdout.read().length === 0)
        fileContents = FILE.read(aFilePath, { charset:"UTF-8" });

    else
    {
        // GCC preprocess the file.
        var gcc = OS.popen("gcc -E -x c -P " + (gccFlags ? gccFlags.join(" ") : "") + " " + OS.enquote(aFilePath), { charset:"UTF-8" }),
            chunk = "";

        while (chunk = gcc.stdout.read())
            fileContents += chunk;
    }

    if (!shouldObjjPreprocess)
        return fileContents;

    // Preprocess contents into fragments.
    // FIXME: should calculate relative path, etc.
    try
    {
        var executable = ObjectiveJ.preprocess(fileContents, FILE.basename(aFilePath), objjcFlags);
    }
    catch (anException)
    {print(anException);
        var lines = fileContents.split("\n"),
            PAD = 3,
            lineNumber = anException.lineNumber || anException.line,
            errorInfo = "Syntax error in " + aFilePath +
                        " on preprocessed line number " + lineNumber + "\n\n" +
                        "\t" + lines.slice(Math.max(0, lineNumber - 1 - PAD), lineNumber + PAD).join("\n\t");

        print(errorInfo);

        throw errorInfo;
    }

    var preprocessed = "@STATIC;1.0;",
        fileDependencies = executable.fileDependencies(),
        index = 0,
        count = fileDependencies.length;

    for (; index < count; ++index)
        preprocessed += fileDependencies[index].toMarkedString();

    var code = executable.code();

    if (shouldCompress)
    {
        var code = compress("function(){" + code + "}", FILE.basename(aFilePath));

        code = code.substr("function(){".length, code.length - "function(){};\n\n".length);
    }

    preprocessed += "t;" + code.length + ";" + code;

    return preprocessed;
}

function resolveFlags(args)
{
    var filePaths = [],
        outputFilePaths = [],

        index = 0,
        count = args.length,

        gccFlags = [],
        objjcFlags = OBJJ_PREPROCESSOR_PREPROCESS | OBJJ_PREPROCESSOR_SYNTAX;    

    for (; index < count; ++index)
    {
        var argument = args[index];
        
        if (argument === "-o")
        {
            if (++index < count)
                outputFilePaths.push(args[index]);
        }
        
        else if (argument.indexOf("-D") === 0)
            gccFlags.push(argument)
            
        else if (argument.indexOf("-U") === 0)
            gccFlags.push(argument);
            
        else if (argument.indexOf("-E") === 0)
            objjcFlags &= ~OBJJ_PREPROCESSOR_PREPROCESS;
            
        else if (argument.indexOf("-S") === 0)
            objjcFlags &= ~OBJJ_PREPROCESSOR_SYNTAX;
            
        else if (argument.indexOf("-g") === 0)
            objjcFlags |= OBJJ_PREPROCESSOR_DEBUG_SYMBOLS;
            
        else if (argument.indexOf("-O") === 0)
            objjcFlags |= OBJJ_PREPROCESSOR_COMPRESS;

        else
            filePaths.push(argument);
    }

    return { filePaths:filePaths, outputFilePaths:outputFilePaths, objjcFlags:objjcFlags, gccFlags:gccFlags };
}

exports.compile = function(aFilePath, flags)
{
    if (flags.split)
        flags = flags.split(/\s+/);

    var resolvedFlags = resolveFlags(flags);

    return compileWithResolvedFlags(aFilePath, resolvedFlags.objjcFlags, resolvedFlags.gccFlags);
}

exports.main = function(args)
{
    // TODO: args parser
    args.shift();

    var resolved = resolveFlags(args),
        outputFilePaths = resolved.outputFilePaths,
        objjcFlags = resolved.objjFlags,
        gccFlags = resolved.gccFlags;

    resolved.filePaths.forEach(function(filePath, index)
    {
        print("Statically Compiling " + filePath);

        FILE.write(outputFilePaths[index], compileWithResolvedFlags(filePath, objjcFlags, gccFlags), { charset: "UTF-8" });
    });
}

if (require.main == module.id)
    exports.main(system.args);
