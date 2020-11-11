import React, { ChangeEvent, MouseEvent, useState, useEffect } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faPlusSquare, faFolderOpen, faBook } from '@fortawesome/free-solid-svg-icons'

import './App.css';
import logo from './logo-horizontal.svg';

import { Modal, Form, Input, Button, Select, Divider, Row, Col, Switch } from 'antd';
import { Board, BoardChip } from './Data';
import { Store, ValidateErrorEntity } from 'rc-field-form/lib/interface';
import { SearchOutlined } from '@ant-design/icons';
import * as timeago from 'timeago.js';
import { useForm } from 'antd/lib/form/Form';
const { Option } = Select;

interface vscode {
  postMessage(message: any): void;
}

declare global {
  const vscode: vscode;
}

function postMessage(message: any) {
  vscode.postMessage(message);
}

type Post = {
  date: string,
  thumbnail: string,
  title: string,
  contents: string[],
  link: string
}

type TemplateParameterInfo = {
	type: string,
	name: string,
	config: string
}

type TemplateInfo = {
	folder: string,
	name: string,
	parameters: TemplateParameterInfo[]
};

type CardProps = {
  title: string,
  paragraph: string
  img: string
  date: string,
  link: string
}

export const Card = ({ title, paragraph, img, date, link }: CardProps) => {
  //img = `https://dummyimage.com/${width}x${height}/eee/aaa`;
  return <div className="App-card">
    <a href={link}>
      <img alt="" src={img} className="App-card-image" />
      <hr className="App-card-separator"></hr>
      <div className="App-card-container">
        <h4>{title}</h4>
        <p className="App-card-date">{timeago.format(date)}</p>
        <p>
          {paragraph}
        </p>
      </div>
    </a>
  </div>
}

type CreateNewProjectProps = {
  visible: boolean,
  setVisible: React.Dispatch<React.SetStateAction<boolean>>
}

const defaultBoard = "Ardesco Combi";
const defaultBoardChip = "nRF 9160";

export const CreateNewProject = ({ visible, setVisible }: CreateNewProjectProps) => {
  const [form] = useForm();
  const [templates, setTemplates] = useState<TemplateInfo[]>([]);
  const [template, setTemplate] = useState<TemplateInfo>();
  const [boards, setBoards] = useState<Board[]>([]);
  const [boardChips, setBoardChips] = useState<BoardChip[]>([]);
  const [path, setPath] = useState<string>('');

  useEffect(() => {
    postMessage({ command: 'request-templates' });
    postMessage({ command: 'request-boards' });
    globalThis.window.addEventListener('message', event => {
      const message: any = event.data;
      switch (message.command) {
        case 'set-folder': {
          setPath(message.uri);
          return;
        }
        case 'response-templates': {
          const data = message.data;
          setTemplates(data.templates);
          setTemplate(data.templates[0]);
          setPath(data.path);
          return;
        }
        case 'response-boards': {
          const data = message.data;
          setBoards(data.boards);
          return;
        }
      }
    });
  }, []);

  const handleOk = (e: MouseEvent<HTMLElement>) => {
    if (!form.validateFields)
      return;

    let values = form.getFieldsValue();
    postMessage({ command: 'new-project', ...values })
    setVisible(false);
  };

  const handleCancel = (e: MouseEvent<HTMLElement>) => {
    setVisible(false);
  };

  const handleFinish = (values: Store) => {
    console.log('Success:', values);
  };

  const handleFinishFailed = (errorInfo: ValidateErrorEntity) => {
    console.log('Failed:', errorInfo);
  };

  const handlePickFolderButton = (event: MouseEvent<HTMLElement>) => {
    event.preventDefault();
    postMessage({ command: 'pick-folder', path: path });
  };

  const handleFolderChange = (event: ChangeEvent<HTMLInputElement>) => {
    setPath(event.target.value);
  };

  const handleTemplateChange = (event: any) => {
    const templateName = event as string;
    var template = templates.find(t => t.name === templateName);
    if (template)
      setTemplate(template);
  };

  const handleBoardChange = (event: any) => {
    const board = boards.find(b => b.name === event);
    if (!board)
      return;
    
    setBoardChips(board.chips);
  };

  useEffect(() => {
    if (template) {
      form.setFieldsValue({ app: template.name });
    }

    if (boardChips.length === 0) {
      form.setFieldsValue({ board: defaultBoard, chip: defaultBoardChip });
      handleBoardChange(defaultBoard);
    }
  });

  return <Modal
    visible={visible}
    title="Create a new project from template"
    okText="Create"
    onCancel={handleCancel}
    onOk={handleOk}
    width="600px"
  >
    <Form name="create-app" form={form} layout="vertical" hideRequiredMark={true}
      initialValues={{ folder: path }}
      onFinish={handleFinish}
      onFinishFailed={handleFinishFailed}
    >
      <Form.Item label="Template app" name="app" required={true}>
        <Select placeholder="Select an option" onChange={handleTemplateChange}>
          {
            templates.map(t =>
              <Option value={t.name}>{t.name}</Option>
            )
          }
        </Select>
      </Form.Item>

      <Row gutter={5}>
        <Col flex="auto">
          <Form.Item label="Board" name="board" required={true}>
            <Select placeholder="Select an option" onChange={handleBoardChange}>
              {
                boards.map(b =>
                  <Option value={b.name}>{b.name}</Option>
                )
              }
            </Select>
          </Form.Item>
        </Col>
        <Col flex="auto">
          <Form.Item label="Board chip" name="chip" required={true}>
            <Select placeholder="Select an option">
              {
                boardChips.map(chip =>
                  <Option value={chip.name}>{chip.name}</Option>
                )
              }
            </Select>
          </Form.Item>
        </Col>
      </Row>

      {
        template?.parameters && template?.parameters.map(param =>
            <Form.Item label={param.name} name={param.config}>
              <Switch />
            </Form.Item>
        )
      }

      <Divider style={{ marginTop: '0px' }} />

      <Form.Item label="Project name" name="name" required={true}>
        <Input placeholder="Please input the project name" value="test" />
      </Form.Item>

      <Row gutter={5} className="App-folder-row">
        <Col flex="auto">
          <Form.Item label="Project folder" name="folder" required={true}>
            <Input placeholder="Please select the root project folder" value={path} onChange={handleFolderChange} />
          </Form.Item>
        </Col>
        <Col>
          <Button type="primary" icon={<SearchOutlined />} onClick={handlePickFolderButton} style={{ marginTop: '29.5px' }}>
            Pick folder
        </Button>
        </Col>
      </Row>
    </Form>
  </Modal>;
}

export function App() {
  const [visible, setVisible] = useState(false);
  const [posts, setPosts] = useState<Post[]>([]);
  const [examples, setExamples] = useState<TemplateInfo[]>([]);

  useEffect(() => {
    postMessage({ command: 'request-examples' });
    postMessage({ command: 'request-posts' });
    globalThis.window.addEventListener('message', event => {
      const message: any = event.data;
      switch (message.command) {
        case 'response-posts': {
          const posts = message.data;
          setPosts(posts);
          return;
        }
        case 'response-examples': {
          const data = message.data;
          setExamples(data.examples);
          return;
        }
      }
    });
  }, []);

  const links = [
    { url: "https://ardesco.sdk", description: "Ardesco Documentation" },
    { url: "https://devzone.nordicsemi.com", description: "Nordic DevZone" },
    { url: "https://docs.zephyrproject.org/latest/", description: "Zephyr Documentation" },
    { url: "https://docs.zephyrproject.org/latest/reference/index.html", description: "Zephyr API Reference" },
  ];

  const onNewProject = (event: MouseEvent) => {
    event.preventDefault();
    setVisible(true);
  }

  const onOpenProject = (event: MouseEvent) => {
    event.preventDefault();
    postMessage({ command: 'open-project' })
  }

  const onDocumentation = (event: MouseEvent) => {
    event.preventDefault();
    postMessage({ command: 'documentation' })
  }

  return (
    <div className="App">
      <CreateNewProject visible={visible} setVisible={setVisible} />
      <div className="App-box">
        <div className="App-leftside">
          <div className="App-header">
            <img src={logo} className="App-logo" alt="logo" />
            <p className="App-heading"><span className="App-title"> <a href="https://ardesco.sdk">Ardesco SDK</a></span><span className="App-subtitle">A world of IoT</span></p>
          </div>
          <div className="App-contents">
            <div className="App-projects">
              <h3>Example Projects</h3>
              <ul>
                {
                  examples.slice(0, links.length).map(example => 
                    <li><a href={example.folder}>{example.name}</a> <span className="App-path">{example.folder}</span></li>
                  )
                }
              </ul>
            </div>
            <div className="App-resources">
              <h3>Resources</h3>
              <ul>
                {
                  links.map(l =>
                    <li><a href={`"${l.url}"`}>{l.description}</a></li>
                  )
                }
              </ul>
            </div>
          </div>
        </div>
        <div id="App-buttons">
          <div className="App-button" onClick={onNewProject}>
            <div className="App-button-container">
              <p className="App-button-main"><FontAwesomeIcon icon={faPlusSquare} /> Create new project</p>
              <p className="App-button-sub">Creates a new project based on a starter template.</p>
            </div>
          </div>
          <div className="App-button" onClick={onOpenProject}>
            <div className="App-button-container">
              <p className="App-button-main"><FontAwesomeIcon icon={faFolderOpen} /> Open an existing project</p>
              <p className="App-button-sub">Opens an existing project from the filesystem.</p>
            </div>
          </div>
          <div className="App-button" onClick={onDocumentation}>
            <div className="App-button-container">
              <p className="App-button-main"><FontAwesomeIcon icon={faBook} /> Documentation</p>
              <p className="App-button-sub">Learn everything there is to know about Ardesco.</p>
            </div>
          </div>
        </div>
      </div>
      <div className="App-separator-container">
        <hr className="App-separator"></hr>
        <h3 className="App-separator-heading">Recent posts</h3>
      </div>
      <div className="App-posts">
        {
          posts.map(post =>
            <Card title={post.title} paragraph={post.contents[0]}
              img={post.thumbnail} date={post.date} link={post.link}></Card>
          )
        }
      </div>
    </div>
  );
}

export default App;
