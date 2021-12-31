/*
 * Copyright (c) 2021 Huawei Device Co., Ltd.
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

import * as ts from "typescript";
import {
    Literal,
    LiteralBuffer,
    LiteralTag
} from "./literal";
import { LOGD } from "../log";
import { TypeChecker } from "../typeChecker";
import { TypeRecorder } from "../typeRecorder";
import { PandaGen } from "../pandagen";
import * as jshelpers from "../jshelpers";
import { access } from "fs";

export enum PrimitiveType {
    ANY = -1,
    NUMBER,
    BOOLEAN,
    BIGINT,
    STRING,
    SYMBOL,
    NULL,
    UNDEFINED,
    INT,
    _LENGTH = 50
}

export enum L2Type {
    _COUNTER,
    CLASS,
    CLASSINST,
    FUNCTION,
    UNION,
    ARRAY,
    OBJECT, // object literal
    EXTERNAL
}

export enum ModifierAbstract {
    NONABSTRACT,
    ABSTRACT
}

export enum ModifierStatic {
    NONSTATIC,
    STATIC
}

export enum ModifierReadonly {
    NONREADONLY,
    READONLY
}

export enum AccessFlag {
    PUBLIC,
    PRIVATE,
    PROTECTED
}

type ClassMemberFunction = ts.MethodDeclaration | ts.ConstructorDeclaration | ts.GetAccessorDeclaration | ts.SetAccessorDeclaration;

export abstract class BaseType {

    abstract transfer2LiteralBuffer(): LiteralBuffer;
    protected typeChecker = TypeChecker.getInstance();
    protected typeRecorder = TypeRecorder.getInstance();

    // this is needed for type like class, since it's declaration is in a certain place
    // other types like primitives don't need this
    protected addCurrentType(node: ts.Node, index: number) {
        this.typeRecorder.addType2Index(node, index);
    }

    protected setVariable2Type(variableNode: ts.Node, index: number, isUserDefinedType: boolean) {
        this.typeRecorder.setVariable2Type(variableNode, index, isUserDefinedType);
    }

    protected tryGetTypeIndex(typeNode: ts.Node) {
        return this.typeRecorder.tryGetTypeIndex(typeNode);
    }

    protected createType(node: ts.Node, newExpressionFlag: boolean, variableNode?: ts.Node) {
        switch (node.kind) {
            case ts.SyntaxKind.MethodDeclaration:
            case ts.SyntaxKind.Constructor:
            case ts.SyntaxKind.GetAccessor:
            case ts.SyntaxKind.SetAccessor: {
                new FunctionType(<ts.FunctionLikeDeclaration>node, variableNode);
                break;
            }
            case ts.SyntaxKind.ClassDeclaration: {
                new ClassType(<ts.ClassDeclaration>node, newExpressionFlag, variableNode);
                break;
            }
            // create other type as project goes on;
            default:
                LOGD("Error: Currently this type is not supported");
                // throw new Error("Currently this type is not supported");
        }
    }

    protected getOrCreateUserDefinedType(node: ts.Identifier, newExpressionFlag: boolean, variableNode?: ts.Node) {
        let typeIndex = PrimitiveType.ANY;
        let declNode = this.typeChecker.getTypeDeclForIdentifier(node);
        if (declNode) {
            typeIndex = this.tryGetTypeIndex(declNode);
            if (typeIndex == PrimitiveType.ANY) {
                this.createType(declNode, newExpressionFlag, variableNode);
                typeIndex = this.tryGetTypeIndex(declNode);
            }
        }
        return typeIndex;
    }

    protected getTypeIndexForDeclWithType(
        node: ts.FunctionLikeDeclaration | ts.ParameterDeclaration | ts.PropertyDeclaration | ts.PropertySignature | ts.MethodSignature, variableNode?: ts.Node): number {
        if (node.type) {
            // check for newExpression 
            let newExpressionFlag = false;
            if (node.kind == ts.SyntaxKind.PropertyDeclaration && node.initializer && node.initializer.kind == ts.SyntaxKind.NewExpression) {
                newExpressionFlag = true;
            }
            // get typeFlag to check if its a primitive type
            let typeRef = node.type;
            let typeIndex = this.typeChecker.checkDeclarationType(typeRef);
            let isUserDefinedType = false;
            if (typeIndex == PrimitiveType.ANY) {
                let identifier = <ts.Identifier>typeRef.getChildAt(0);
                typeIndex = this.getOrCreateUserDefinedType(identifier, newExpressionFlag, variableNode);
                isUserDefinedType = true;
            }
            if (typeIndex == PrimitiveType.ANY) {
                console.log("ERROR: Type cannot be found for: " + jshelpers.getTextOfNode(node));
                typeIndex = PrimitiveType.ANY;
            }
            // set variable if variable node is given;
            if (variableNode) {
                this.setVariable2Type(variableNode, typeIndex, isUserDefinedType);
            }
            return typeIndex!;
        }
        LOGD("WARNING: node type not found for: " + jshelpers.getTextOfNode(node));
        return PrimitiveType.ANY;
    }

    protected getIndexFromTypeArrayBuffer(type: BaseType): number {
        return PandaGen.appendTypeArrayBuffer(type);
    }

    protected setTypeArrayBuffer(type: BaseType, index: number) {
        PandaGen.setTypeArrayBuffer(type, index);
    }

}

export class PlaceHolderType extends BaseType {
    transfer2LiteralBuffer(): LiteralBuffer {
        return new LiteralBuffer();
    }
}

export class TypeSummary extends BaseType {
    preservedIndex: number = 0;
    userDefinedClassNum: number = 0;
    anonymousRedirect: Array<string> = new Array<string>();
    constructor() {
        super();
        this.preservedIndex = this.getIndexFromTypeArrayBuffer(new PlaceHolderType());
    }

    public setInfo(userDefinedClassNum: number, anonymousRedirect: Array<string>) {
        this.userDefinedClassNum = userDefinedClassNum;
        this.anonymousRedirect = anonymousRedirect;
        this.setTypeArrayBuffer(this, this.preservedIndex);
    }

    transfer2LiteralBuffer(): LiteralBuffer {
        let countBuf = new LiteralBuffer();
        let summaryLiterals: Array<Literal> = new Array<Literal>();
        summaryLiterals.push(new Literal(LiteralTag.INTEGER, L2Type._COUNTER));
        summaryLiterals.push(new Literal(LiteralTag.INTEGER, this.userDefinedClassNum));
        summaryLiterals.push(new Literal(LiteralTag.INTEGER, this.anonymousRedirect.length));
        for (let element of this.anonymousRedirect) {
            summaryLiterals.push(new Literal(LiteralTag.STRING, element));
        }
        countBuf.addLiterals(...summaryLiterals);
        return countBuf;
    }
}

export class ClassType extends BaseType {
    modifier: number = 0; // 0 -> unabstract, 1 -> abstract;
    extendsHeritage: number = -1;
    implementsHeritages: Array<number> = new Array<number>();
    // fileds Array: [typeIndex] [public -> 0, private -> 1, protected -> 2] [readonly -> 1]
    staticFields: Map<string, Array<number>> = new Map<string, Array<number>>();
    staticMethods: Map<string, number> = new Map<string, number>();
    fields: Map<string, Array<number>> = new Map<string, Array<number>>();
    methods: Map<string, number> = new Map<string, number>();
    typeIndex: number;

    constructor(classNode: ts.ClassDeclaration | ts.ClassExpression, newExpressionFlag: boolean, variableNode?: ts.Node) {
        super();
        this.typeIndex = this.getIndexFromTypeArrayBuffer(new PlaceHolderType());
        let shiftedIndex = this.typeIndex + PrimitiveType._LENGTH;
        // record type before its initialization, so its index can be recorded
        // in case there's recursive reference of this type
        this.addCurrentType(classNode, shiftedIndex);

        this.fillInModifiers(classNode);
        this.fillInHeritages(classNode);
        this.fillInFieldsAndMethods(classNode);

        // initialization finished, add variable to type if variable is given
        if (variableNode) {
            // if the variable is a instance, create another classInstType instead of current classType itself
            if (newExpressionFlag) {
                new ClassInstType(variableNode, this.typeIndex);
            } else {
                this.setVariable2Type(variableNode, shiftedIndex, true);
            }
        }
        this.setTypeArrayBuffer(this, this.typeIndex);
        // check typeRecorder
        // this.typeRecorder.getLog(classNode, this.typeIndex);
    }

    public getTypeIndex() {
        return this.typeIndex;
    }

    private fillInModifiers(node: ts.ClassDeclaration | ts.ClassExpression) {
        if (node.modifiers) {
            for (let modifier of node.modifiers) {
                switch (modifier.kind) {
                    case ts.SyntaxKind.AbstractKeyword: {
                        this.modifier = ModifierAbstract.ABSTRACT;
                        break;
                    }
                    case ts.SyntaxKind.ExportKeyword: {
                        break;
                    }
                }
            }
        }
    }

    private fillInHeritages(node: ts.ClassDeclaration | ts.ClassExpression) {
        if (node.heritageClauses) {
            for (let heritage of node.heritageClauses) {
                let heritageFullName = heritage.getText();
                for (let heritageType of heritage.types) {
                    let heritageIdentifier = <ts.Identifier>heritageType.expression;
                    let heritageTypeIndex = this.getOrCreateUserDefinedType(heritageIdentifier, false);
                    if (heritageFullName.startsWith("extends ")) {
                        this.extendsHeritage = heritageTypeIndex;
                    } else if (heritageFullName.startsWith("implements ")) {
                        this.implementsHeritages.push(heritageTypeIndex);
                    }
                }
            }
        }
    }

    private fillInFields(member: ts.PropertyDeclaration) {
        // collect modifier info
        let fieldName: string = "";
        switch (member.name.kind) {
            case ts.SyntaxKind.Identifier:
            case ts.SyntaxKind.StringLiteral:
            case ts.SyntaxKind.NumericLiteral:
                fieldName = jshelpers.getTextOfIdentifierOrLiteral(member.name);
                break;
            case ts.SyntaxKind.ComputedPropertyName:
                fieldName = "#computed";
                break;
            default:
                throw new Error("Invalid proerty name");
        }

        // Array: [typeIndex] [public -> 0, private -> 1, protected -> 2] [readonly -> 1]
        let fieldInfo = Array<number>(PrimitiveType.ANY, AccessFlag.PUBLIC, ModifierReadonly.NONREADONLY);
        let isStatic: boolean = false;
        if (member.modifiers) {
            for (let modifier of member.modifiers) {
                switch (modifier.kind) {
                    case ts.SyntaxKind.StaticKeyword: {
                        isStatic = true;
                        break;
                    }
                    case ts.SyntaxKind.PrivateKeyword: {
                        fieldInfo[1] = AccessFlag.PRIVATE;
                        break;
                    }
                    case ts.SyntaxKind.ProtectedKeyword: {
                        fieldInfo[1] = AccessFlag.PROTECTED;
                        break;
                    }
                    case ts.SyntaxKind.ReadonlyKeyword: {
                        fieldInfo[2] = ModifierReadonly.READONLY;
                        break;
                    }
                }
            }
        }
        // collect type info
        let variableNode = member.name ? member.name : undefined;
        fieldInfo[0] = this.getTypeIndexForDeclWithType(member, variableNode);

        if (isStatic) {
            this.staticFields.set(fieldName, fieldInfo);
        } else {
            this.fields.set(fieldName, fieldInfo);
        }
    }

    private fillInMethods(member: ClassMemberFunction) {
        /**
         * a method like declaration in a new class must be a new type,
         * create this type and add it into typeRecorder
         */
        let variableNode = member.name ? member.name : undefined;
        let funcType = new FunctionType(<ts.FunctionLikeDeclaration>member, variableNode);

        // Then, get the typeIndex and fill in the methods array
        let typeIndex = this.tryGetTypeIndex(member);
        let funcModifier = funcType.getModifier();
        if (funcModifier) {
            this.staticMethods.set(funcType.getFunctionName(), typeIndex!);
        } else {
            this.methods.set(funcType.getFunctionName(), typeIndex!);
        }
    }

    private fillInFieldsAndMethods(node: ts.ClassDeclaration | ts.ClassExpression) {
        if (node.members) {
            for (let member of node.members) {
                switch (member.kind) {
                    case ts.SyntaxKind.MethodDeclaration:
                    case ts.SyntaxKind.Constructor:
                    case ts.SyntaxKind.GetAccessor:
                    case ts.SyntaxKind.SetAccessor: {
                        this.fillInMethods(<ClassMemberFunction>member);
                        break;
                    }
                    case ts.SyntaxKind.PropertyDeclaration: {
                        this.fillInFields(<ts.PropertyDeclaration>member);
                        break;
                    }
                }
            }
        }
    }

    transfer2LiteralBuffer() {
        let classTypeBuf = new LiteralBuffer();
        let classTypeLiterals: Array<Literal> = new Array<Literal>();
        // the first element is to determine the L2 type
        classTypeLiterals.push(new Literal(LiteralTag.INTEGER, L2Type.CLASS));
        classTypeLiterals.push(new Literal(LiteralTag.INTEGER, this.modifier));

        classTypeLiterals.push(new Literal(LiteralTag.INTEGER, this.extendsHeritage));
        classTypeLiterals.push(new Literal(LiteralTag.INTEGER, this.implementsHeritages.length));
        this.implementsHeritages.forEach(heritage => {
            classTypeLiterals.push(new Literal(LiteralTag.INTEGER, heritage));
        });

        // record unstatic fields and methods
        this.transferFields2Literal(classTypeLiterals, false);
        this.transferMethods2Literal(classTypeLiterals, false);

        // record static methods and fields;
        this.transferFields2Literal(classTypeLiterals, true);
        this.transferMethods2Literal(classTypeLiterals, true);

        classTypeBuf.addLiterals(...classTypeLiterals);
        return classTypeBuf;
    }

    private transferFields2Literal(classTypeLiterals: Array<Literal>, isStatic: boolean) {
        let transferredTarget: Map<string, Array<number>> = isStatic ? this.staticFields : this.fields;

        classTypeLiterals.push(new Literal(LiteralTag.INTEGER, transferredTarget.size));
        transferredTarget.forEach((typeInfo, name) => {
            classTypeLiterals.push(new Literal(LiteralTag.STRING, name));
            classTypeLiterals.push(new Literal(LiteralTag.INTEGER, typeInfo[0])); // typeIndex
            classTypeLiterals.push(new Literal(LiteralTag.INTEGER, typeInfo[1])); // accessFlag
            classTypeLiterals.push(new Literal(LiteralTag.INTEGER, typeInfo[2])); // readonly
        });
    }

    private transferMethods2Literal(classTypeLiterals: Array<Literal>, isStatic: boolean) {
        let transferredTarget: Map<string, number> = isStatic ? this.staticMethods : this.methods;

        classTypeLiterals.push(new Literal(LiteralTag.INTEGER, transferredTarget.size));
        transferredTarget.forEach((typeInfo, name) => {
            classTypeLiterals.push(new Literal(LiteralTag.STRING, name));
            classTypeLiterals.push(new Literal(LiteralTag.INTEGER, typeInfo));
        });
    }
}

export class ClassInstType extends BaseType {
    shiftedReferredClassIndex: number = 0; // the referred class in the type system;
    constructor(variableNode: ts.Node, referredClassIndex: number) {
        super();
        // use referedClassIndex to point to the actually class type of this instance
        this.shiftedReferredClassIndex = referredClassIndex + PrimitiveType._LENGTH;

        // map variable to classInstType, which has a newly generated index
        let currIndex = this.getIndexFromTypeArrayBuffer(this);
        let shiftedIndex = currIndex + PrimitiveType._LENGTH;
        this.setVariable2Type(variableNode, shiftedIndex, true);
    }

    transfer2LiteralBuffer(): LiteralBuffer {
        let classInstBuf = new LiteralBuffer();
        let classInstLiterals: Array<Literal> = new Array<Literal>();

        classInstLiterals.push(new Literal(LiteralTag.INTEGER, L2Type.CLASSINST));
        classInstLiterals.push(new Literal(LiteralTag.INTEGER, this.shiftedReferredClassIndex));
        classInstBuf.addLiterals(...classInstLiterals);

        return classInstBuf;
    }
}

export class FunctionType extends BaseType {
    name: string = '';
    accessFlag: number = 0; // 0 -> public -> 0, private -> 1, protected -> 2
    modifierStatic: number = 0; // 0 -> unstatic, 1 -> static
    parameters: Array<number> = new Array<number>();
    returnType: number = 0;
    typeIndex: number;

    constructor(funcNode: ts.FunctionLikeDeclaration | ts.MethodSignature, variableNode?: ts.Node) {
        super();
        this.typeIndex = this.getIndexFromTypeArrayBuffer(new PlaceHolderType());
        let shiftedIndex = this.typeIndex + PrimitiveType._LENGTH;
        // record type before its initialization, so its index can be recorded
        // in case there's recursive reference of this type
        this.addCurrentType(funcNode, shiftedIndex);

        if (funcNode.name) {
            this.name = jshelpers.getTextOfIdentifierOrLiteral(funcNode.name);
        } else {
            this.name = "constructor";
        }
        this.fillInModifiers(funcNode);
        this.fillInParameters(funcNode);
        this.fillInReturn(funcNode);

        // initialization finished, add variable to type if variable is given
        if (variableNode) {
            this.setVariable2Type(variableNode, shiftedIndex, true);
        }
        this.setTypeArrayBuffer(this, this.typeIndex);

        // check typeRecorder
        // this.typeRecorder.getLog(funcNode, this.typeIndex);
    }

    public getFunctionName() {
        return this.name;
    }

    public getTypeIndex() {
        return this.typeIndex;
    }

    private fillInModifiers(node: ts.FunctionLikeDeclaration | ts.MethodSignature) {
        if (node.modifiers) {
            for (let modifier of node.modifiers) {
                switch (modifier.kind) {
                    case ts.SyntaxKind.PrivateKeyword: {
                        this.accessFlag = AccessFlag.PRIVATE;
                        break;
                    }
                    case ts.SyntaxKind.ProtectedKeyword: {
                        this.accessFlag = AccessFlag.PROTECTED;
                        break;
                    }
                    case ts.SyntaxKind.StaticKeyword: {
                        this.modifierStatic = ModifierStatic.STATIC;
                    }
                }
            }
        }
    }

    private fillInParameters(node: ts.FunctionLikeDeclaration | ts.MethodSignature) {
        if (node.parameters) {
            for (let parameter of node.parameters) {
                let variableNode = parameter.name;
                let typeIndex = this.getTypeIndexForDeclWithType(parameter, variableNode);
                this.parameters.push(typeIndex);
            }
        }
    }

    private fillInReturn(node: ts.FunctionLikeDeclaration | ts.MethodSignature) {
        let typeIndex = this.getTypeIndexForDeclWithType(node);
        this.returnType = typeIndex;
    }

    getModifier() {
        return this.modifierStatic;
    }

    transfer2LiteralBuffer(): LiteralBuffer {
        let funcTypeBuf = new LiteralBuffer();
        let funcTypeLiterals: Array<Literal> = new Array<Literal>();
        funcTypeLiterals.push(new Literal(LiteralTag.INTEGER, L2Type.FUNCTION));
        funcTypeLiterals.push(new Literal(LiteralTag.INTEGER, this.accessFlag));
        funcTypeLiterals.push(new Literal(LiteralTag.INTEGER, this.modifierStatic));
        funcTypeLiterals.push(new Literal(LiteralTag.STRING, this.name));
        funcTypeLiterals.push(new Literal(LiteralTag.INTEGER, this.parameters.length));
        this.parameters.forEach((type) => {
            funcTypeLiterals.push(new Literal(LiteralTag.INTEGER, type));
        });

        funcTypeLiterals.push(new Literal(LiteralTag.INTEGER, this.returnType));
        funcTypeBuf.addLiterals(...funcTypeLiterals);
        return funcTypeBuf;
    }
}

export class ExternalType extends BaseType {
    fullRedirectNath: string;
    typeIndex: number;

    constructor(importName: string, redirectPath: string) {
        super();
        this.fullRedirectNath = `#${importName}#${redirectPath}`;
        this.typeIndex = this.getIndexFromTypeArrayBuffer(this);
    }

    public getTypeIndex() {
        return this.typeIndex;
    }

    transfer2LiteralBuffer(): LiteralBuffer {
        let ImpTypeBuf = new LiteralBuffer();
        let ImpTypeLiterals: Array<Literal> = new Array<Literal>();
        ImpTypeLiterals.push(new Literal(LiteralTag.INTEGER, L2Type.EXTERNAL));
        ImpTypeLiterals.push(new Literal(LiteralTag.STRING, this.fullRedirectNath));
        ImpTypeBuf.addLiterals(...ImpTypeLiterals);
        return ImpTypeBuf;
    }
}

export class UnionType extends BaseType {
    unionedTypeArray: Array<number> = [];
    typeIndex: number = PrimitiveType.ANY;
    shiftedTypeIndex: number = PrimitiveType.ANY;

    constructor(typeNode: ts.Node) {
        super();
        this.setOrReadFromArrayRecord(typeNode);
    }

    setOrReadFromArrayRecord(typeNode: ts.Node) {
        let unionStr = typeNode.getText();
        if (this.hasUnionTypeMapping(unionStr)) {
            this.shiftedTypeIndex = this.getFromUnionTypeMap(unionStr)!;
        } else {
            this.typeIndex = this.getIndexFromTypeArrayBuffer(new PlaceHolderType());
            this.shiftedTypeIndex = this.typeIndex + PrimitiveType._LENGTH;
            this.fillInUnionArray(typeNode, this.unionedTypeArray);
            this.setUnionTypeMap(unionStr, this.shiftedTypeIndex);
            this.setTypeArrayBuffer(this, this.typeIndex);
        }
    }

    hasUnionTypeMapping(unionStr: string) {
        return this.typeRecorder.hasUnionTypeMapping(unionStr);
    }

    getFromUnionTypeMap(unionStr: string) {
        return this.typeRecorder.getFromUnionTypeMap(unionStr);
    }

    setUnionTypeMap(unionStr: string, shiftedTypeIndex: number) {
        return this.typeRecorder.setUnionTypeMap(unionStr, shiftedTypeIndex);
    }

    fillInUnionArray(typeNode: ts.Node, unionedTypeArray: Array<number>) {
        for (let element of (<ts.UnionType><any>typeNode).types) {
            let elementNode = <ts.TypeNode><any>element;
            let typeIndex = this.typeChecker.getOrCreateRecordForTypeNode(elementNode);
            unionedTypeArray.push(typeIndex!);
        }
    }

    transfer2LiteralBuffer(): LiteralBuffer {
        let UnionTypeBuf = new LiteralBuffer();
        let UnionTypeLiterals: Array<Literal> = new Array<Literal>();
        UnionTypeLiterals.push(new Literal(LiteralTag.INTEGER, L2Type.UNION));
        UnionTypeLiterals.push(new Literal(LiteralTag.INTEGER, this.unionedTypeArray.length));
        for (let type of this.unionedTypeArray) {
            UnionTypeLiterals.push(new Literal(LiteralTag.INTEGER, type));
        }
        UnionTypeBuf.addLiterals(...UnionTypeLiterals);
        return UnionTypeBuf;
    }    
}

export class ArrayType extends BaseType {
    referedTypeIndex: number = PrimitiveType.ANY;
    typeIndex: number = PrimitiveType.ANY;
    shiftedTypeIndex: number = PrimitiveType.ANY;
    constructor(typeNode: ts.Node) {
        super();
        let elementNode = (<ts.ArrayTypeNode><any>typeNode).elementType;
        this.referedTypeIndex = this.typeChecker.getOrCreateRecordForTypeNode(elementNode);
        this.setOrReadFromArrayRecord();
    }

    setOrReadFromArrayRecord() {
        if (this.hasArrayTypeMapping(this.referedTypeIndex)) {
            this.shiftedTypeIndex = this.getFromArrayTypeMap(this.referedTypeIndex)!;
        } else {
            this.typeIndex = this.getIndexFromTypeArrayBuffer(this);
            this.shiftedTypeIndex = this.typeIndex + PrimitiveType._LENGTH;
            this.setTypeArrayBuffer(this, this.typeIndex);
            this.setArrayTypeMap(this.referedTypeIndex, this.shiftedTypeIndex);
        }
    }

    getReferencedType(typeNode: ts.Node) {
        let elementNode = (<ts.ArrayTypeNode><any>typeNode).elementType;
        let typeIndex = this.typeChecker.checkDeclarationType(elementNode);
        if (typeIndex) {
            return typeIndex;
        } else if (elementNode.kind == ts.SyntaxKind.TypeReference) {
            let typeName = elementNode.getChildAt(0);
            let typeDecl = this.typeChecker.getTypeDeclForInitializer(typeName, false);
            if (typeDecl) {
                typeIndex = this.typeChecker.checkForTypeDecl(typeName, typeDecl, false, true);
            } else {
                typeIndex = 0;
            }
            return typeIndex;
        }
        return 0;
    }

    hasArrayTypeMapping(referedTypeIndex: number) {
        return this.typeRecorder.hasArrayTypeMapping(referedTypeIndex);
    }

    getFromArrayTypeMap(referedTypeIndex: number) {
        return this.typeRecorder.getFromArrayTypeMap(referedTypeIndex);
    }
    
    setArrayTypeMap(referedTypeIndex: number, shiftedTypeIndex: number) {
        return this.typeRecorder.setArrayTypeMap(referedTypeIndex, shiftedTypeIndex);
    }

    transfer2LiteralBuffer(): LiteralBuffer {
        let classInstBuf = new LiteralBuffer();
        let classInstLiterals: Array<Literal> = new Array<Literal>();
        classInstLiterals.push(new Literal(LiteralTag.INTEGER, L2Type.ARRAY));
        classInstLiterals.push(new Literal(LiteralTag.INTEGER, this.referedTypeIndex));
        classInstBuf.addLiterals(...classInstLiterals);
        return classInstBuf;
    }
}

export class ObjectLiteralType extends BaseType {
    private properties: Map<string, number> = new Map<string, number>();
    private methods: Array<number> = new Array<number>();

    constructor(obj: ts.ObjectLiteralExpression) {
        super();

        // TODO extract object info here
    }

    transfer2LiteralBuffer(): LiteralBuffer {
        let objTypeBuf = new LiteralBuffer();

        return objTypeBuf;
    }
}

export class InterfaceType extends BaseType {
    heritages: Array<number> = new Array<number>();
    // fileds Array: [typeIndex] [public -> 0, private -> 1, protected -> 2] [readonly -> 1]
    fields: Map<string, Array<number>> = new Map<string, Array<number>>();
    methods: Array<number> = new Array<number>();
    typeIndex: number;

    constructor(interfaceNode: ts.InterfaceDeclaration, variableNode?: ts.Node) {
        super();
        this.typeIndex = this.getIndexFromTypeArrayBuffer(new PlaceHolderType());
        let shiftedIndex = this.typeIndex + PrimitiveType._LENGTH;
        // record type before its initialization, so its index can be recorded
        // in case there's recursive reference of this type
        this.addCurrentType(interfaceNode, shiftedIndex);

        this.fillInHeritages(interfaceNode);
        this.fillInFieldsAndMethods(interfaceNode);

        // initialization finished, add variable to type if variable is given
        if (variableNode) {
            // if the variable is a instance, create another classInstType instead of current classType itself
            this.setVariable2Type(variableNode, shiftedIndex, true);
        }
        this.setTypeArrayBuffer(this, this.typeIndex);
    }

    public getTypeIndex() {
        return this.typeIndex;
    }

    private fillInHeritages(node: ts.InterfaceDeclaration) {
        if (node.heritageClauses) {
            for (let heritage of node.heritageClauses) {
                for (let heritageType of heritage.types) {
                    let heritageIdentifier = <ts.Identifier>heritageType.expression;
                    let heritageTypeIndex = this.getOrCreateUserDefinedType(heritageIdentifier, false);
                    this.heritages.push(heritageTypeIndex);
                }
            }
        }
    }

    private fillInFields(member: ts.PropertySignature) {
        // collect modifier info
        let fieldName: string = "";
        switch (member.name.kind) {
            case ts.SyntaxKind.Identifier:
            case ts.SyntaxKind.StringLiteral:
            case ts.SyntaxKind.NumericLiteral:
                fieldName = jshelpers.getTextOfIdentifierOrLiteral(member.name);
                break;
            case ts.SyntaxKind.ComputedPropertyName:
                fieldName = "#computed";
                break;
            default:
                throw new Error("Invalid proerty name");
        }

        // Array: [typeIndex] [public -> 0, private -> 1, protected -> 2] [readonly -> 1]
        let fieldInfo = Array<number>(PrimitiveType.ANY, AccessFlag.PUBLIC, ModifierReadonly.NONREADONLY);
        if (member.modifiers) {
            for (let modifier of member.modifiers) {
                switch (modifier.kind) {
                    case ts.SyntaxKind.PrivateKeyword: {
                        fieldInfo[1] = AccessFlag.PRIVATE;
                        break;
                    }
                    case ts.SyntaxKind.ProtectedKeyword: {
                        fieldInfo[1] = AccessFlag.PROTECTED;
                        break;
                    }
                    case ts.SyntaxKind.ReadonlyKeyword: {
                        fieldInfo[2] = ModifierReadonly.READONLY;
                        break;
                    }
                }
            }
        }
        // collect type info
        let variableNode = member.name ? member.name : undefined;
        fieldInfo[0] = this.getTypeIndexForDeclWithType(member, variableNode);

        this.fields.set(fieldName, fieldInfo);
    }

    private fillInMethods(member: ts.MethodSignature) {
        /**
         * a method like declaration in a new class must be a new type,
         * create this type and add it into typeRecorder
         */
        let variableNode = member.name ? member.name : undefined;
        let funcType = new FunctionType(<ts.MethodSignature>member, variableNode);

        // Then, get the typeIndex and fill in the methods array
        let typeIndex = this.tryGetTypeIndex(member);
        this.methods.push(typeIndex!);
    }

    private fillInFieldsAndMethods(node: ts.InterfaceDeclaration) {
        if (node.members) {
            for (let member of node.members) {
                switch (member.kind) {
                    case ts.SyntaxKind.MethodSignature:{
                        this.fillInMethods(<ts.MethodSignature>member);
                        break;
                    }
                    case ts.SyntaxKind.PropertySignature: {
                        this.fillInFields(<ts.PropertySignature>member);
                        break;
                    }
                }
            }
        }
    }

    transfer2LiteralBuffer() {
        let classTypeBuf = new LiteralBuffer();
        let classTypeLiterals: Array<Literal> = new Array<Literal>();
        // the first element is to determine the L2 type
        classTypeLiterals.push(new Literal(LiteralTag.INTEGER, L2Type.CLASS));

        classTypeLiterals.push(new Literal(LiteralTag.INTEGER, this.heritages.length));
        this.heritages.forEach(heritage => {
            classTypeLiterals.push(new Literal(LiteralTag.INTEGER, heritage));
        });

        // record fields and methods
        this.transferFields2Literal(classTypeLiterals);
        this.transferMethods2Literal(classTypeLiterals);

        classTypeBuf.addLiterals(...classTypeLiterals);
        return classTypeBuf;
    }

    private transferFields2Literal(classTypeLiterals: Array<Literal>) {
        let transferredTarget: Map<string, Array<number>> = this.fields;

        classTypeLiterals.push(new Literal(LiteralTag.INTEGER, transferredTarget.size));
        transferredTarget.forEach((typeInfo, name) => {
            classTypeLiterals.push(new Literal(LiteralTag.STRING, name));
            classTypeLiterals.push(new Literal(LiteralTag.INTEGER, typeInfo[0])); // typeIndex
            classTypeLiterals.push(new Literal(LiteralTag.INTEGER, typeInfo[1])); // accessFlag
            classTypeLiterals.push(new Literal(LiteralTag.INTEGER, typeInfo[2])); // readonly
        });
    }

    private transferMethods2Literal(classTypeLiterals: Array<Literal>) {
        let transferredTarget: Array<number> = this.methods;

        classTypeLiterals.push(new Literal(LiteralTag.INTEGER, transferredTarget.length));
        transferredTarget.forEach(method => {
            classTypeLiterals.push(new Literal(LiteralTag.INTEGER, method));
        });
    }
}
